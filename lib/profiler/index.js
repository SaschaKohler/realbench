const { Profiler } = require('./build/Release/profiler.node');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

function runInWorker(options, method, args) {
  // callgrind hat 10-50x Overhead; Timeout entsprechend setzen
  const durationSeconds = options.durationSeconds || 30;
  const timeoutMs = (durationSeconds * 60 + 120) * 1000;
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'profiler_worker.js'), {
      workerData: { options, method, args },
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        reject(new Error(`Profiler worker timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    worker.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });
    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

class ProfilerClient {
  constructor(options = {}) {
    this.options = {
      // Basic options
      frequencyHz: options.frequencyHz || 99,
      durationSeconds: options.durationSeconds || 30,
      includeKernel: options.includeKernel || false,
      
      // P0: perf stat mode options
      mode: options.mode || 'sampling',  // 'sampling' or 'stat'
      statDetailed: options.statDetailed || false,
      
      // P0/P1: Hardware counter configuration
      hwCounters: options.hwCounters || {},
      
      // P1b: Context switch tracing
      traceContextSwitches: options.traceContextSwitches || false,
    };
    
    // Validate mode
    if (!['sampling', 'stat'].includes(this.options.mode)) {
      throw new Error(`Invalid mode: ${this.options.mode}. Must be 'sampling' or 'stat'`);
    }
  }
  
  /**
   * Create a preconfigured ProfilerClient for cache analysis (P1)
   * Measures L1 and LLC cache performance
   */
  static forCacheAnalysis(durationSeconds = 30) {
    return new ProfilerClient({
      mode: 'stat',
      durationSeconds,
      hwCounters: {
        cycles: true,
        instructions: true,
        l1DcacheLoads: true,
        l1DcacheLoadMisses: true,
        llcLoads: true,
        llcLoadMisses: true,
      },
    });
  }
  
  /**
   * Create a preconfigured ProfilerClient for TLB analysis (P1)
   * Measures Data and Instruction TLB performance
   */
  static forTlbAnalysis(durationSeconds = 30) {
    return new ProfilerClient({
      mode: 'stat',
      durationSeconds,
      hwCounters: {
        cycles: true,
        instructions: true,
        dtlbLoads: true,
        dtlbLoadMisses: true,
        itlbLoads: true,
        itlbLoadMisses: true,
      },
    });
  }
  
  /**
   * Create a preconfigured ProfilerClient for multithreading analysis (P1b)
   * Traces context switches with stack traces
   */
  static forMultithreadingAnalysis(durationSeconds = 30) {
    return new ProfilerClient({
      mode: 'sampling',
      durationSeconds,
      traceContextSwitches: true,
    });
  }

  async profilePid(pid) {
    return runInWorker(this.options, 'profilePid', [pid]);
  }

  async profileBinary(binaryPath, args = []) {
    return runInWorker(this.options, 'profileBinary', [binaryPath, args]);
  }

  static diff(baseline, current) {
    return Profiler.diff(baseline, current);
  }
}

/**
 * Calculate cache hit rates from counter results (P1)
 * @param {Array} counters - Array of CounterResult from profile
 * @returns {Object} Cache hit rates and metrics
 */
function calculateCacheMetrics(counters) {
  const metrics = {};
  const findCounter = (name) => counters.find(c => c.name === name)?.value || 0;
  
  // L1 Data Cache
  const l1Loads = findCounter('L1-dcache-loads');
  const l1LoadMisses = findCounter('L1-dcache-load-misses');
  if (l1Loads > 0) {
    metrics.l1DcacheHitRate = (1 - l1LoadMisses / l1Loads) * 100;
    metrics.l1DcacheMissRate = (l1LoadMisses / l1Loads) * 100;
  }
  
  // LLC
  const llcLoads = findCounter('LLC-loads');
  const llcLoadMisses = findCounter('LLC-load-misses');
  if (llcLoads > 0) {
    metrics.llcHitRate = (1 - llcLoadMisses / llcLoads) * 100;
    metrics.llcMissRate = (llcLoadMisses / llcLoads) * 100;
  }
  
  // Memory-bound indicator
  const cycles = findCounter('cycles');
  if (cycles > 0 && llcLoadMisses > 0) {
    metrics.memoryBoundRatio = llcLoadMisses / cycles;
  }
  
  return metrics;
}

/**
 * Calculate TLB metrics from counter results (P1)
 * @param {Array} counters - Array of CounterResult from profile
 * @returns {Object} TLB metrics
 */
function calculateTlbMetrics(counters) {
  const metrics = {};
  const findCounter = (name) => counters.find(c => c.name === name)?.value || 0;
  
  // Data TLB
  const dtlbLoads = findCounter('dTLB-loads');
  const dtlbLoadMisses = findCounter('dTLB-load-misses');
  if (dtlbLoads > 0) {
    metrics.dtlbHitRate = (1 - dtlbLoadMisses / dtlbLoads) * 100;
    metrics.dtlbMissRate = (dtlbLoadMisses / dtlbLoads) * 100;
  }
  
  // Instruction TLB
  const itlbLoads = findCounter('iTLB-loads');
  const itlbLoadMisses = findCounter('iTLB-load-misses');
  if (itlbLoads > 0) {
    metrics.itlbHitRate = (1 - itlbLoadMisses / itlbLoads) * 100;
    metrics.itlbMissRate = (itlbLoadMisses / itlbLoads) * 100;
  }
  
  return metrics;
}

/**
 * Analyze context switch patterns (P1b)
 * @param {Object} result - ProfileResult from multithreading analysis
 * @returns {Object} Scheduling analysis
 */
function analyzeContextSwitches(result) {
  if (!result.hasContextSwitchData || !result.contextSwitchStats) {
    return null;
  }
  
  const stats = result.contextSwitchStats;
  const switches = result.contextSwitches || [];
  
  return {
    // Switch frequency
    switchesPerSecond: stats.totalSwitches / (result.timeElapsedSeconds || 1),
    
    // Preemption ratio
    preemptionRatio: stats.involuntarySwitches / (stats.totalSwitches || 1),
    
    // CPU migration rate
    migrationRatio: stats.migrations / (stats.totalSwitches || 1),
    
    // Thread count
    threadCount: stats.uniqueThreads,
    
    // Time series of switches per CPU (if multiple CPUs)
    cpuDistribution: switches.reduce((acc, sw) => {
      acc[sw.cpu] = (acc[sw.cpu] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  ProfilerClient,
  Profiler,
  // Analysis utilities
  calculateCacheMetrics,
  calculateTlbMetrics,
  analyzeContextSwitches,
  // Constants
  ProfileMode: {
    SAMPLING: 'sampling',
    STAT: 'stat',
  },
};
