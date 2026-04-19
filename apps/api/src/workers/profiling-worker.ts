import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { profilingRuns } from '../db/schema.js';
import { downloadBinary, uploadFlamegraph } from '../services/storage.js';
import { analyzeProfiling } from '../services/llm.js';
import { getBoss, PROFILING_QUEUE, ProfilingJobData } from './queue.js';
import { profileBinary } from '../services/profiler.js';

const execFileAsync = promisify(execFile);

async function processProfilingJob(data: ProfilingJobData) {
  const { runId, projectId, binaryKey, commitSha, branch, buildType } = data;

  await db
    .update(profilingRuns)
    .set({ status: 'processing' })
    .where(eq(profilingRuns.id, runId));

  try {
    const binaryBuffer = await downloadBinary(binaryKey);
    const binaryPath = join(tmpdir(), `realbench-${runId}`);
    await writeFile(binaryPath, binaryBuffer);

    // Patch ELF interpreter so glibc-linked binaries (Ubuntu/Debian) run on Alpine/musl
    try {
      await execFileAsync('patchelf', [
        '--set-interpreter', '/lib/ld-musl-x86_64.so.1',
        binaryPath,
      ]);
    } catch (_e) {
      // Non-ELF or already musl – ignore
    }

    let profileResult;
    try {
      profileResult = await profileBinary(binaryPath, {
        durationSeconds: 30,
        frequencyHz: 99,
        includeKernel: false,
      });
    } finally {
      // Binary darf erst gelöscht werden, nachdem der Profiler fertig ist.
      // (callgrind hält die Datei während der Analyse offen)
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
        createdAt: new Date(),
        projectName: projectResult.name,
        language: projectResult.language,
      },
      undefined
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
    console.error('Profiling job failed:', error);

    await db
      .update(profilingRuns)
      .set({ status: 'failed' })
      .where(eq(profilingRuns.id, runId));

    throw error;
  }
}

async function startWorker() {
  const boss = await getBoss();

  await boss.work<ProfilingJobData>(PROFILING_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      console.log(`Processing job ${job.id}`);
      await processProfilingJob(job.data);
      console.log(`Job ${job.id} completed`);
    }
  });

  boss.on('error', (err) => {
    console.error('pg-boss error:', err);
  });

  console.log('✅ Profiling worker started, waiting for jobs...');
}

startWorker().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
