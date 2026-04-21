import PgBoss from 'pg-boss';

export const PROFILING_QUEUE = 'profiling';

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      deleteAfterDays: 7,
      archiveCompletedAfterSeconds: 86400,
      max: 5, // Limit pool size to prevent too many idle connections
    });
    await boss.start();
    await boss.createQueue(PROFILING_QUEUE);
  }
  return boss;
}

export async function enqueueProfilingJob(data: ProfilingJobData): Promise<string | null> {
  const b = await getBoss();
  const jobId = await b.send(PROFILING_QUEUE, data);
  if (!jobId) {
    throw new Error(`Failed to enqueue profiling job: queue '${PROFILING_QUEUE}' rejected the job`);
  }
  return jobId;
}

export interface HardwareCountersConfig {
  cycles?: boolean;
  instructions?: boolean;
  cacheReferences?: boolean;
  cacheMisses?: boolean;
  branchInstructions?: boolean;
  branchMisses?: boolean;
  stalledCyclesFrontend?: boolean;
  stalledCyclesBackend?: boolean;
  contextSwitches?: boolean;
  cpuMigrations?: boolean;
  pageFaults?: boolean;
  l1DcacheLoads?: boolean;
  l1DcacheLoadMisses?: boolean;
  l1DcacheStores?: boolean;
  l1DcacheStoreMisses?: boolean;
  l1IcacheLoads?: boolean;
  l1IcacheLoadMisses?: boolean;
  llcLoads?: boolean;
  llcLoadMisses?: boolean;
  llcStores?: boolean;
  llcStoreMisses?: boolean;
  dtlbLoads?: boolean;
  dtlbLoadMisses?: boolean;
  dtlbStores?: boolean;
  dtlbStoreMisses?: boolean;
  itlbLoads?: boolean;
  itlbLoadMisses?: boolean;
  custom?: string[];
}

export interface ProfilingOptions {
  mode?: 'sampling' | 'stat';
  statDetailed?: boolean;
  hwCounters?: HardwareCountersConfig;
  traceContextSwitches?: boolean;
  durationSeconds?: number;
  frequencyHz?: number;
  includeKernel?: boolean;
}

export interface ProfilingJobData {
  runId: string;
  projectId: string;
  binaryKey: string;
  commitSha: string;
  branch: string;
  buildType: string;
  // P0/P1/P1b: Profiling configuration
  profilingOptions?: ProfilingOptions;
}
