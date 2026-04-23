import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { profilingRuns } from '../db/schema.js';
import { downloadBinary, uploadFlamegraph } from '../services/storage.js';
import { analyzeProfiling, analyzeStatRun } from '../services/llm.js';
import { extractSourceSnippets } from '../services/source-extractor.js';
import { getBoss, PROFILING_QUEUE, ProfilingJobData } from './queue.js';
import { profileBinary } from '../services/profiler.js';
import { buildComment, postOrUpdatePrComment, postPendingComment } from '../services/github.js';

async function processProfilingJob(data: ProfilingJobData, markJobDone: () => Promise<void>) {
  const { runId, projectId, binaryKey, commitSha, branch, buildType, profilingOptions, githubRepo, githubPrNumber, githubToken } = data;

  const githubCtx = githubRepo && githubPrNumber && githubToken
    ? { repo: githubRepo, prNumber: githubPrNumber, token: githubToken }
    : null;

  // Job sofort bestätigen - Profiling läuft unabhängig
  await markJobDone();
  console.log(`Job ${runId} acknowledged, starting profiling...`);
  console.log(`Profiling options:`, JSON.stringify(profilingOptions, null, 2));

  await db
    .update(profilingRuns)
    .set({ status: 'processing' })
    .where(eq(profilingRuns.id, runId));

  if (githubCtx) {
    const pendingCommentId = await postPendingComment(githubCtx, commitSha);
    if (pendingCommentId) {
      await db
        .update(profilingRuns)
        .set({ githubCommentId: pendingCommentId })
        .where(eq(profilingRuns.id, runId));
    }
  }

  try {
    const binaryBuffer = await downloadBinary(binaryKey);
    const binaryPath = join(tmpdir(), `realbench-${runId}`);
    await writeFile(binaryPath, binaryBuffer);

    let profileResult;
    try {
      // Build profiler options from job data
      const profilerOpts = {
        durationSeconds: profilingOptions?.durationSeconds || 30,
        frequencyHz: profilingOptions?.frequencyHz || 99,
        includeKernel: profilingOptions?.includeKernel || false,
        mode: profilingOptions?.mode || 'sampling',
        statDetailed: profilingOptions?.statDetailed || false,
        hwCounters: profilingOptions?.hwCounters,
        traceContextSwitches: profilingOptions?.traceContextSwitches || false,
      };
      
      console.log(`Starting profiling with mode: ${profilerOpts.mode}`);
      if (profilerOpts.mode === 'stat' && profilerOpts.hwCounters) {
        const enabledCounters = Object.entries(profilerOpts.hwCounters)
          .filter(([_, v]) => v)
          .map(([k, _]) => k);
        console.log(`Hardware counters enabled: ${enabledCounters.join(', ')}`);
      }
      if (profilerOpts.traceContextSwitches) {
        console.log('Context switch tracing enabled');
      }
      
      // Profiling läuft im separaten Worker Thread - nicht blockierend für DB
      profileResult = await profileBinary(binaryPath, profilerOpts);
    } finally {
      await unlink(binaryPath).catch(() => {});
    }

    const hotspots = profileResult.hotspots.map((h: any) => {
      // Parse file:line from symbol if present (format: "function @ file:line")
      let symbol = h.symbol;
      let file: string | undefined = undefined;
      let line: number | undefined = undefined;

      const atIdx = symbol.indexOf(' @ ');
      if (atIdx !== -1) {
        const locationPart = symbol.slice(atIdx + 3);
        symbol = symbol.slice(0, atIdx);

        // Parse "file.cpp:123" or just "file.cpp"
        const colonIdx = locationPart.lastIndexOf(':');
        if (colonIdx !== -1) {
          file = locationPart.slice(0, colonIdx);
          const lineNum = parseInt(locationPart.slice(colonIdx + 1), 10);
          if (!isNaN(lineNum)) {
            line = lineNum;
          }
        } else {
          file = locationPart;
        }
      }

      return {
        symbol,
        file,
        line,
        selfPct: h.selfPct,
        totalPct: h.totalPct,
        callCount: h.callCount,
      };
    });

    const flamegraphUrl = await uploadFlamegraph(runId, profileResult.flamegraphSvg, 'svg');

    const projectResult = await db.query.projects.findFirst({
      where: (projects, { eq }) => eq(projects.id, projectId),
    });

    if (!projectResult) {
      throw new Error('Project not found');
    }

    // Extract source code snippets for hotspots that have file/line info
    console.log(`Extracting source snippets for ${hotspots.length} hotspots...`);
    const sourceSnippets = await extractSourceSnippets(
      hotspots,
      projectResult.language,
      {
        sourceRoots: [tmpdir(), process.cwd(), process.env.SOURCE_ROOT || '/app/source'],
        contextLines: 8,
        maxFileSize: 1024 * 1024,
      }
    );
    console.log(`Extracted ${sourceSnippets.length} source snippets`);

    const isStatMode = profileResult.isStatMode || profilingOptions?.mode === 'stat';

    const analysis = isStatMode
      ? await analyzeStatRun({
          projectName: projectResult.name,
          language: projectResult.language,
          commitSha,
          branch,
          buildType,
          timeElapsedSeconds: profileResult.timeElapsedSeconds ?? null,
          cpuUtilizationPercent: profileResult.cpuUtilizationPercent ?? null,
          counters: profileResult.counters ?? null,
          contextSwitchStats: profileResult.contextSwitchStats ?? null,
        })
      : await analyzeProfiling(
          {
            id: runId,
            projectId,
            commitSha,
            branch,
            buildType,
            status: 'processing',
            hotspots,
            suggestions: null,
            flamegraphUrl: null,
            regressionDetected: null,
            durationMs: null,
            error: null,
            createdAt: new Date(),
            projectName: projectResult.name,
            language: projectResult.language,
            profilingMode: profilingOptions?.mode || 'sampling',
            isStatMode: false,
            timeElapsedSeconds: null,
            cpuUtilizationPercent: null,
            counters: null,
            hasContextSwitchData: profilingOptions?.traceContextSwitches || false,
            contextSwitchStats: null,
            contextSwitches: null,
            githubRepo: githubRepo ?? null,
            githubPrNumber: githubPrNumber ?? null,
            githubCommentId: null,
          },
          undefined,
          undefined,
          sourceSnippets
        );

    // Prepare counter data - truncate if too large
    const counters = profileResult.counters || [];
    const truncatedCounters = counters.length > 100 ? counters.slice(0, 100) : counters;
    
    // Prepare context switches - limit to prevent DB bloat
    const contextSwitches = profileResult.contextSwitches || [];
    const truncatedSwitches = contextSwitches.length > 1000 
      ? contextSwitches.slice(0, 1000) 
      : contextSwitches;

    await db
      .update(profilingRuns)
      .set({
        status: 'done',
        flamegraphUrl,
        hotspots,
        suggestions: analysis.suggestions,
        regressionDetected: analysis.regressionDetected,
        durationMs: profileResult.durationMs,
        // P0: perf stat mode fields
        profilingMode: profilingOptions?.mode || 'sampling',
        isStatMode: profileResult.isStatMode || false,
        timeElapsedSeconds: profileResult.timeElapsedSeconds || null,
        cpuUtilizationPercent: profileResult.cpuUtilizationPercent || null,
        // P0/P1: Hardware counter results
        counters: truncatedCounters.length > 0 ? truncatedCounters : null,
        // P1b: Context switch tracing
        hasContextSwitchData: profileResult.hasContextSwitchData || false,
        contextSwitchStats: profileResult.contextSwitchStats || null,
        contextSwitches: truncatedSwitches.length > 0 ? truncatedSwitches : null,
      })
      .where(eq(profilingRuns.id, runId));

    if (githubCtx) {
      const dashboardUrl = `${process.env.DASHBOARD_URL ?? 'https://app.realbench.dev'}/runs/${runId}`;
      const commentBody = buildComment({
        runId,
        commitSha,
        branch,
        buildType,
        dashboardUrl,
        hotspots,
        analysis,
        durationMs: profileResult.durationMs ?? null,
        flamegraphUrl: flamegraphUrl ?? null,
      });
      await postOrUpdatePrComment(githubCtx, commentBody);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Profiling job failed:', errorMessage);

    await db
      .update(profilingRuns)
      .set({ status: 'failed', error: errorMessage })
      .where(eq(profilingRuns.id, runId));

    throw error;
  }
}

async function startWorker() {
  const boss = await getBoss();

  await boss.work<ProfilingJobData>(PROFILING_QUEUE, { 
    batchSize: 1,
    includeMetadata: true  // Ermöglicht Zugriff auf job.id
  }, async (jobs) => {
    for (const job of jobs) {
      const jobId = (job as any).id;
      console.log(`Processing job ${jobId}`);
      // Job sofort bestätigen, dann asynchron verarbeiten (fire-and-forget)
      processProfilingJob(job.data, async () => {
        // Job sofort als erledigt markieren - Profiling läuft im Hintergrund
        await boss!.complete(PROFILING_QUEUE, jobId);
      }).catch(err => {
        console.error(`Background processing failed for job ${jobId}:`, err);
      });
      console.log(`Job ${jobId} acknowledged, processing continues in background`);
    }
  });

  boss.on('error', (err) => {
    console.error('pg-boss error:', err);
    // Exit on fatal connection errors so Fly.io restarts with fresh connections
    const errorMessage = err.message || '';
    if (errorMessage.includes('Connection terminated unexpectedly') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('ECONNRESET')) {
      console.error('Fatal connection error, exiting to restart...');
      process.exit(1);
    }
  });

  console.log('✅ Profiling worker started, waiting for jobs...');
}

startWorker().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
