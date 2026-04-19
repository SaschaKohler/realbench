import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { profilingRuns } from '../db/schema.js';
import { downloadBinary, uploadFlamegraph } from '../services/storage.js';
import { analyzeProfiling } from '../services/llm.js';
import { extractSourceSnippets } from '../services/source-extractor.js';
import { getBoss, PROFILING_QUEUE, ProfilingJobData } from './queue.js';
import { profileBinary } from '../services/profiler.js';

async function processProfilingJob(data: ProfilingJobData, markJobDone: () => Promise<void>) {
  const { runId, projectId, binaryKey, commitSha, branch, buildType } = data;

  // Job sofort bestätigen - Profiling läuft unabhängig
  await markJobDone();
  console.log(`Job ${runId} acknowledged, starting profiling...`);

  await db
    .update(profilingRuns)
    .set({ status: 'processing' })
    .where(eq(profilingRuns.id, runId));

  try {
    const binaryBuffer = await downloadBinary(binaryKey);
    const binaryPath = join(tmpdir(), `realbench-${runId}`);
    await writeFile(binaryPath, binaryBuffer);

    let profileResult;
    try {
      // Profiling läuft im separaten Worker Thread - nicht blockierend für DB
      profileResult = await profileBinary(binaryPath, {
        durationSeconds: 30,
        frequencyHz: 99,
        includeKernel: false,
      });
    } finally {
      await unlink(binaryPath).catch(() => {});
    }

    const hotspots = profileResult.hotspots.map((h: any) => ({
      symbol: h.symbol,
      file: 'unknown',
      line: 0,
      selfPct: h.selfPct,
      totalPct: h.totalPct,
      callCount: h.callCount,
    }));

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

    const analysis = await analyzeProfiling(
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
      },
      undefined,
      undefined,
      sourceSnippets
    );

    await db
      .update(profilingRuns)
      .set({
        status: 'done',
        flamegraphUrl,
        hotspots,
        suggestions: analysis.suggestions,
        regressionDetected: analysis.regressionDetected,
        durationMs: profileResult.durationMs,
      })
      .where(eq(profilingRuns.id, runId));
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
