import { chmod } from 'fs/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

interface HardwareCounters {
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

interface ProfilerOptions {
  durationSeconds?: number;
  frequencyHz?: number;
  includeKernel?: boolean;
  // P0: perf stat mode
  mode?: 'sampling' | 'stat';
  statDetailed?: boolean;
  hwCounters?: HardwareCounters;
  // P1b: context switch tracing
  traceContextSwitches?: boolean;
}

interface CounterResult {
  name: string;
  value: number;
  unitRatio: number;
  unitName: string;
  comment: string;
}

interface ContextSwitchStats {
  totalSwitches: number;
  voluntarySwitches: number;
  involuntarySwitches: number;
  migrations: number;
  avgSwitchIntervalMs: number;
  uniqueThreads: number;
  mostActiveThread: number;
}

interface ContextSwitchEvent {
  timestampMs: number;
  cpu: number;
  prevPid: number;
  nextPid: number;
  prevComm: string;
  nextComm: string;
  isWakeup: boolean;
  stack?: StackFrame[];
}

interface StackFrame {
  symbol: string;
  file: string;
  address: number;
  line: number;
}

interface Hotspot {
  symbol: string;
  selfPct: number;
  totalPct: number;
  callCount: number;
  selfSamples: number;
  totalSamples: number;
}

interface ProfileResult {
  hotspots: Hotspot[];
  flamegraphSvg: string;
  flamegraphJson: string;
  totalSamples: number;
  durationMs: number;
  targetBinary: string;
  commitSha: string;
  exitCode: number;
  errorMessage: string;
  // P0: perf stat mode results
  isStatMode?: boolean;
  timeElapsedSeconds?: number;
  cpuUtilizationPercent?: number;
  // P0/P1: Hardware counter results
  counters?: CounterResult[];
  // P1b: Context switch tracing
  hasContextSwitchData?: boolean;
  contextSwitchStats?: ContextSwitchStats;
  contextSwitches?: ContextSwitchEvent[];
}

let profilerNative: any = null;

async function getProfiler() {
  if (!profilerNative) {
    try {
      const profilerPath = join(__dirname, '..', '..', '..', '..', 'lib', 'profiler', 'index.js');
      console.log('Loading native profiler from:', profilerPath);
      const mod = require(profilerPath);
      profilerNative = mod.ProfilerClient;
    } catch (error) {
      console.warn('Native profiler not available, using mock mode:', error);
      return null;
    }
  }
  return profilerNative;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export async function profileBinary(
  binaryPath: string,
  options: ProfilerOptions = {}
): Promise<ProfileResult> {
  const ProfilerClient = await getProfiler();

  if (!ProfilerClient) {
    console.warn('Using mock profiler - C++ profiler not built');
    return createMockProfileResult(binaryPath);
  }

  // Build profiler options
  const profilerOptions: any = {
    durationSeconds: options.durationSeconds || 30,
    frequencyHz: options.frequencyHz || 99,
    includeKernel: options.includeKernel || false,
  };
  
  // P0: perf stat mode options
  if (options.mode) {
    profilerOptions.mode = options.mode;
  }
  if (options.statDetailed) {
    profilerOptions.statDetailed = options.statDetailed;
  }
  if (options.hwCounters) {
    profilerOptions.hwCounters = options.hwCounters;
  }
  
  // P1b: Context switch tracing
  if (options.traceContextSwitches) {
    profilerOptions.traceContextSwitches = options.traceContextSwitches;
  }

  const profiler = new ProfilerClient(profilerOptions);

  // Timeout formula adjusted for large binaries (SPEC §13)
  const durationSeconds = options.durationSeconds || 30;
  const timeoutMs = (durationSeconds * 120 + 300) * 1000;

  await chmod(binaryPath, 0o755);
  const result = await withTimeout(
    profiler.profileBinary(binaryPath, []) as Promise<ProfileResult>,
    timeoutMs,
    'profileBinary'
  );
  return result;
}

export async function profilePid(
  pid: number,
  options: ProfilerOptions = {}
): Promise<ProfileResult> {
  const ProfilerClient = await getProfiler();

  if (!ProfilerClient) {
    throw new Error('Native profiler not available');
  }

  // Build profiler options
  const profilerOptions: any = {
    durationSeconds: options.durationSeconds || 30,
    frequencyHz: options.frequencyHz || 99,
    includeKernel: options.includeKernel || false,
  };
  
  // P0: perf stat mode options
  if (options.mode) {
    profilerOptions.mode = options.mode;
  }
  if (options.statDetailed) {
    profilerOptions.statDetailed = options.statDetailed;
  }
  if (options.hwCounters) {
    profilerOptions.hwCounters = options.hwCounters;
  }
  
  // P1b: Context switch tracing
  if (options.traceContextSwitches) {
    profilerOptions.traceContextSwitches = options.traceContextSwitches;
  }

  const profiler = new ProfilerClient(profilerOptions);

  try {
    const result = await profiler.profilePid(pid);
    return result;
  } catch (error) {
    console.error('Profiling failed:', error);
    throw new Error(`Profiling failed: ${error}`);
  }
}

function createMockProfileResult(binaryPath: string): ProfileResult {
  const mockHotspots: Hotspot[] = [
    {
      symbol: 'main',
      selfPct: 45.2,
      totalPct: 100.0,
      callCount: 1,
      selfSamples: 4520,
      totalSamples: 10000,
    },
    {
      symbol: 'compute_heavy_function',
      selfPct: 25.8,
      totalPct: 35.6,
      callCount: 1000000,
      selfSamples: 2580,
      totalSamples: 3560,
    },
    {
      symbol: 'allocate_memory',
      selfPct: 15.3,
      totalPct: 18.2,
      callCount: 500000,
      selfSamples: 1530,
      totalSamples: 1820,
    },
  ];

  const mockSvg = `<?xml version="1.0"?>
<svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="1200" height="400" fill="#eeeeee"/>
  <text x="600" y="30" text-anchor="middle" font-size="17">Mock Flamegraph (C++ Profiler Not Built)</text>
  <text x="600" y="50" text-anchor="middle" font-size="12" fill="#666">Build native addon to see real profiling data</text>
  <rect x="10" y="80" width="540" height="20" fill="#ff6b6b"/>
  <text x="15" y="95" font-size="11">main (45.2%)</text>
  <rect x="10" y="100" width="310" height="20" fill="#ffa07a"/>
  <text x="15" y="115" font-size="11">compute_heavy_function (25.8%)</text>
  <rect x="10" y="120" width="184" height="20" fill="#ffb347"/>
  <text x="15" y="135" font-size="11">allocate_memory (15.3%)</text>
</svg>`;

  return {
    hotspots: mockHotspots,
    flamegraphSvg: mockSvg,
    flamegraphJson: JSON.stringify({ hotspots: mockHotspots }, null, 2),
    totalSamples: 10000,
    durationMs: 30000,
    targetBinary: binaryPath,
    commitSha: '',
    exitCode: 0,
    errorMessage: '',
  };
}
