import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Realistic demo data — represents a C++ matrix-multiply benchmark profiled
// on a 4-core Fly.io VM with perf_event_open sampling at 99 Hz for 30 s.
// ---------------------------------------------------------------------------

const DEMO_RUN = {
  commitSha: 'a7c3f2e — demo/matrix-benchmark',
  branch: 'main',
  buildType: 'RelWithDebInfo',
  status: 'completed',
  profilingMode: 'sampling',
  timeElapsedSeconds: 30.12,
  cpuUtilizationPercent: 387,
  flamegraphUrl: null as string | null,   // no real SVG — we show a placeholder
  error: null as string | null,
  isStatMode: false,
  hasContextSwitchData: true,
  contextSwitchStats: {
    totalSwitches: 4_218,
    voluntarySwitches: 3_891,
    involuntarySwitches: 327,
    migrations: 42,
    uniqueThreads: 4,
    avgSwitchIntervalMs: 7.13,
  },
};

const DEMO_HOTSPOTS = [
  { symbol: 'MatMul::multiply(double const*, double const*, double*, int) @ src/matmul.cpp:47', selfPct: 42.31, totalPct: 48.10, callCount: 12_847, file: 'src/matmul.cpp', line: 47 },
  { symbol: 'MatMul::transpose(double const*, double*, int) @ src/matmul.cpp:112', selfPct: 18.56, totalPct: 18.56, callCount: 5_621, file: 'src/matmul.cpp', line: 112 },
  { symbol: 'std::__introsort_loop<…> @ /usr/include/c++/13/bits/stl_algo.h:1886', selfPct: 9.23, totalPct: 12.40, callCount: 2_804, file: null, line: null },
  { symbol: 'tcmalloc::CentralFreeList::RemoveRange @ tcmalloc.cc:412', selfPct: 6.71, totalPct: 6.71, callCount: 2_034, file: null, line: null },
  { symbol: '__lll_lock_wait', selfPct: 5.89, totalPct: 5.89, callCount: 1_782, file: null, line: null },
  { symbol: 'MatMul::validate_result(double const*, double const*, int) @ src/matmul.cpp:201', selfPct: 4.12, totalPct: 4.12, callCount: 1_250, file: 'src/matmul.cpp', line: 201 },
  { symbol: 'std::mutex::lock()', selfPct: 3.44, totalPct: 3.44, callCount: 1_042, file: null, line: null },
  { symbol: '__pthread_mutex_lock', selfPct: 2.91, totalPct: 2.91, callCount: 882, file: null, line: null },
  { symbol: '__clock_nanosleep', selfPct: 2.18, totalPct: 2.18, callCount: 661, file: null, line: null },
  { symbol: 'MatMul::init_random(double*, int) @ src/matmul.cpp:18', selfPct: 1.87, totalPct: 1.87, callCount: 566, file: 'src/matmul.cpp', line: 18 },
];

const DEMO_SUGGESTIONS = [
  {
    impact: 'high' as const,
    symbol: 'MatMul::multiply',
    file: 'src/matmul.cpp',
    line: 47,
    problem: 'Inner loop iterates column-major over the right matrix, causing L1 cache misses on every access. With a 4096×4096 matrix each element fetch crosses a cache line boundary.',
    fix: 'Transpose the right-hand matrix before multiplication, or use a tiled/blocked algorithm (e.g. 64×64 tiles) to keep sub-matrices in L1. Consider using SIMD intrinsics (_mm256_fmadd_pd) for the inner accumulation loop.',
    estimatedSpeedup: '3–5×',
  },
  {
    impact: 'medium' as const,
    symbol: 'MatMul::transpose',
    file: 'src/matmul.cpp',
    line: 112,
    problem: 'Naive transpose iterates row-by-row but writes column-by-column, thrashing the TLB for large matrices. This function takes 18.6% of total time — nearly half the cost of the actual multiplication.',
    fix: 'Use a cache-oblivious recursive transpose, or tile the transpose with 32×32 blocks. For matrices >2048, consider transposing in-place with block swaps to avoid the temporary buffer allocation.',
    estimatedSpeedup: '2–3×',
  },
  {
    impact: 'low' as const,
    symbol: 'tcmalloc::CentralFreeList::RemoveRange',
    file: null,
    line: null,
    problem: 'Frequent small allocations in the hot path contend on tcmalloc\'s central free list lock. 6.7% of samples are inside the allocator.',
    fix: 'Pre-allocate working buffers outside the loop and reuse them. If temporary matrices are needed, use a thread-local arena allocator to avoid cross-thread contention.',
    estimatedSpeedup: '~10–15% reduction in allocator overhead',
  },
];

const DEMO_COUNTERS = [
  { name: 'cycles', value: 89_241_372_018, comment: '' },
  { name: 'instructions', value: 142_018_493_201, comment: '' },
  { name: 'cache-references', value: 1_204_819_321, comment: '' },
  { name: 'cache-misses', value: 184_293_012, comment: '15.29% of all cache refs' },
  { name: 'branch-instructions', value: 18_429_301_204, comment: '' },
  { name: 'branch-misses', value: 92_146_510, comment: '0.50% of all branches' },
  { name: 'L1-dcache-loads', value: 48_291_032_109, comment: '' },
  { name: 'L1-dcache-load-misses', value: 2_414_551_605, comment: '5.00% of all L1 loads' },
  { name: 'LLC-loads', value: 184_293_012, comment: '' },
  { name: 'LLC-load-misses', value: 36_858_602, comment: '20.00% of all LLC loads' },
];

// ---------------------------------------------------------------------------
// Helpers — identical to RunDetail.tsx
// ---------------------------------------------------------------------------

const SLEEP_WAIT_SYMBOLS = new Set([
  '__lll_lock_wait', '__lll_lock_wait_private', '__futex_abstimed_wait_cancelable64',
  '__clock_nanosleep', '__pthread_clockjoin_ex', '__lll_lock_wake',
  '__lll_lock_wake_private', 'sem_wait', 'pthread_cond_wait',
  'epoll_wait', 'nanosleep', 'poll', 'select',
]);

const SYNC_SYMBOLS = new Set([
  'std::mutex::lock()', '__pthread_mutex_lock',
  'std::unique_lock<std::mutex>::lock()',
  'std::unique_lock<std::mutex>::unique_lock(std::mutex&)',
  'std::condition_variable::wait',
]);

function classifySymbol(sym: string): 'sleep' | 'sync' | 'cpu' {
  const base = sym.split(' ')[0].split('@')[0].trim();
  if (SLEEP_WAIT_SYMBOLS.has(base)) return 'sleep';
  if (SYNC_SYMBOLS.has(base) || base.startsWith('std::mutex') || base.startsWith('std::unique_lock') || base.startsWith('std::condition_variable')) return 'sync';
  return 'cpu';
}

function demangleSymbol(sym: string): string {
  const atIdx = sym.indexOf(' @ ');
  const location = atIdx !== -1 ? sym.slice(atIdx) : '';
  let name = atIdx !== -1 ? sym.slice(0, atIdx) : sym;
  name = name.replace(/^[\w:*&<>\s]+?(?=\bstd::|\b[A-Z][\w:]*::)/, '');
  name = name.replace(/<[^<>]{40,}>/g, '<…>');
  return (name + location).replace(/\s*\(discriminator \d+\)/, '');
}

function SymbolBadge({ kind }: { kind: 'sleep' | 'sync' | 'cpu' }) {
  if (kind === 'sleep') {
    return (
      <span title="Thread was sleeping or blocked — not CPU work." className="ml-2 px-1.5 py-0.5 text-xs rounded bg-slate-700 text-slate-300 align-middle">
        wait
      </span>
    );
  }
  if (kind === 'sync') {
    return (
      <span title="Synchronization overhead — locks / condvars." className="ml-2 px-1.5 py-0.5 text-xs rounded bg-orange-900 text-orange-300 align-middle">
        sync
      </span>
    );
  }
  return null;
}

function SelfPctBar({ pct, kind, maxPct }: { pct: number; kind: 'sleep' | 'sync' | 'cpu'; maxPct: number }) {
  const color = kind === 'sleep' ? 'bg-slate-600' : kind === 'sync' ? 'bg-orange-700' : 'bg-blue-600';
  const widthPct = maxPct > 0 ? (pct / maxPct) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-700 rounded-full h-1.5 flex-shrink-0">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${Math.min(widthPct, 100)}%` }} />
      </div>
      <span>{pct.toFixed(2)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DemoRunDetail() {
  const run = DEMO_RUN;
  const hotspots = DEMO_HOTSPOTS;
  const counters = DEMO_COUNTERS;
  const nonZeroCounters = counters.filter((c) => c.value > 0);

  const totalSleepPct = hotspots
    .filter((h) => classifySymbol(h.symbol) === 'sleep')
    .reduce((sum, h) => sum + h.selfPct, 0);
  const totalSyncPct = hotspots
    .filter((h) => classifySymbol(h.symbol) === 'sync')
    .reduce((sum, h) => sum + h.selfPct, 0);
  const totalCpuPct = hotspots
    .filter((h) => classifySymbol(h.symbol) === 'cpu')
    .reduce((sum, h) => sum + h.selfPct, 0);

  const maxSelfPct = Math.max(...hotspots.map((h) => h.selfPct), 1);

  return (
    <div className="min-h-screen bg-gray-900">
      <nav className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to="/" className="text-2xl font-bold text-white hover:text-gray-300">
              RealBench
            </Link>
            <span className="px-3 py-1 rounded-full bg-yellow-900/60 text-yellow-300 text-xs font-semibold tracking-wide uppercase">
              Live Demo
            </span>
          </div>
        </div>
      </nav>

      {/* Demo banner */}
      <div className="bg-blue-950/60 border-b border-blue-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-blue-200 text-sm">
            <strong>This is a demo.</strong> You're looking at a real profiling result from a C++ matrix-multiplication benchmark.
            Everything below — hotspots, hardware counters, optimization suggestions — is what RealBench produces on every CI run.
            <Link to="/" className="ml-2 underline hover:text-white transition">Sign up free</Link> to profile your own binaries.
          </p>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">Profiling Run</h2>
          <p className="text-gray-400 font-mono text-sm">{run.commitSha}</p>
        </div>

        {/* Run summary */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Run Details</h3>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3">
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Branch</dt>
              <dd className="text-white font-mono text-sm mt-0.5">{run.branch}</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Build Type</dt>
              <dd className="text-white text-sm mt-0.5 capitalize">{run.buildType}</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Status</dt>
              <dd className="text-green-400 text-sm mt-0.5">{run.status}</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Wall Time</dt>
              <dd className="text-white text-sm mt-0.5">{run.timeElapsedSeconds}s</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Mode</dt>
              <dd className="mt-0.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900 text-blue-200">
                  sampling
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">CPUs Utilized</dt>
              <dd className="text-white text-sm mt-0.5">{(run.cpuUtilizationPercent / 100).toFixed(2)}</dd>
            </div>
          </dl>
        </div>

        {/* Flamegraph placeholder */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-3">Flamegraph</h3>
          <p className="text-gray-400 text-sm mb-3">
            Interactive call stack visualization. Wider frames = more CPU time. Click to zoom, double-click to reset.
          </p>
          <div className="rounded-lg overflow-hidden border border-gray-700 bg-gray-900 flex items-center justify-center" style={{ height: '420px' }}>
            <div className="text-center px-8">
              {/* Simplified inline flamegraph sketch */}
              <div className="mb-6 mx-auto max-w-2xl">
                <div className="bg-orange-700/80 rounded-sm py-2 text-xs text-white font-mono mb-0.5">all (100%)</div>
                <div className="flex gap-0.5 mb-0.5">
                  <div className="bg-red-600/80 rounded-sm py-2 text-xs text-white font-mono flex-[48]">MatMul::multiply (48.1%)</div>
                  <div className="bg-orange-500/80 rounded-sm py-2 text-xs text-white font-mono flex-[19]">transpose (18.6%)</div>
                  <div className="bg-yellow-600/80 rounded-sm py-2 text-xs text-white font-mono flex-[12]">introsort (12.4%)</div>
                  <div className="bg-green-700/60 rounded-sm py-2 text-xs text-white font-mono flex-[21]">other</div>
                </div>
                <div className="flex gap-0.5 mb-0.5">
                  <div className="bg-red-700/70 rounded-sm py-1.5 text-xs text-white font-mono flex-[42]">inner_loop (42.3%)</div>
                  <div className="bg-red-500/50 rounded-sm py-1.5 text-xs text-white font-mono flex-[6]">acc</div>
                  <div className="bg-orange-600/60 rounded-sm py-1.5 text-xs text-white font-mono flex-[19]">cache_swap</div>
                  <div className="bg-yellow-700/50 rounded-sm py-1.5 text-xs text-white font-mono flex-[9]">compare</div>
                  <div className="bg-gray-700/50 rounded-sm py-1.5 text-xs text-gray-400 font-mono flex-[24]"></div>
                </div>
              </div>
              <p className="text-gray-500 text-sm">
                Real runs render an interactive Canvas flamegraph — click frames to zoom, search to highlight, double-click to reset.
              </p>
            </div>
          </div>
        </div>

        {/* Thread efficiency summary */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-3">Thread Time Budget</h3>
          <p className="text-gray-400 text-sm mb-4">
            Breakdown of sampled time by category. <span className="text-slate-400">Wait</span> time means threads were blocked — not doing useful work.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-700 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{totalCpuPct.toFixed(1)}%</div>
              <div className="text-gray-400 text-sm mt-1">CPU Work</div>
              <div className="text-gray-500 text-xs mt-0.5">active computation</div>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <div className="text-2xl font-bold text-slate-400">{totalSleepPct.toFixed(1)}%</div>
              <div className="text-gray-400 text-sm mt-1">Blocking / Wait</div>
              <div className="text-gray-500 text-xs mt-0.5">sleep, futex, nanosleep</div>
            </div>
            <div className="bg-gray-700 rounded-lg p-4">
              <div className={`text-2xl font-bold ${totalSyncPct > 10 ? 'text-orange-400' : 'text-slate-400'}`}>
                {totalSyncPct.toFixed(1)}%
              </div>
              <div className="text-gray-400 text-sm mt-1">Sync Overhead</div>
              <div className="text-gray-500 text-xs mt-0.5">mutex, condvar lock</div>
            </div>
          </div>
        </div>

        {/* Hardware Counters */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Hardware Performance Counters</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {nonZeroCounters.map((counter, index) => (
              <div key={index} className="bg-gray-700 rounded-lg p-3">
                <div className="text-gray-400 text-xs font-mono mb-1">{counter.name}</div>
                <div className="text-white font-mono text-sm font-medium">{counter.value.toLocaleString()}</div>
                {counter.comment && (
                  <div className="text-gray-500 text-xs mt-0.5">{counter.comment}</div>
                )}
              </div>
            ))}
          </div>
          <div className="p-4 bg-gray-700 rounded-lg">
            <h4 className="font-semibold text-sm mb-3 text-gray-300">Derived Metrics</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-gray-400 text-xs">IPC</div>
                <div className="font-mono text-lg font-bold text-white">1.59</div>
                <div className="text-gray-500 text-xs">moderate</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">L1 Miss Rate</div>
                <div className="font-mono text-lg font-bold text-red-400">5.00%</div>
                <div className="text-gray-500 text-xs">L1 data cache</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">L3 Miss Rate</div>
                <div className="font-mono text-lg font-bold text-red-400">15.29%</div>
                <div className="text-gray-500 text-xs">cache-refs basis</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">LLC Miss Rate</div>
                <div className="font-mono text-lg font-bold text-red-400">20.00%</div>
                <div className="text-gray-500 text-xs">last-level cache</div>
              </div>
            </div>
          </div>
        </div>

        {/* Context Switch Analysis */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Context Switch Analysis</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-gray-700 p-3 rounded-lg">
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Total Switches</dt>
              <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.totalSwitches.toLocaleString()}</dd>
            </div>
            <div className="bg-gray-700 p-3 rounded-lg">
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Voluntary</dt>
              <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.voluntarySwitches.toLocaleString()}</dd>
            </div>
            <div className="bg-gray-700 p-3 rounded-lg">
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Involuntary</dt>
              <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.involuntarySwitches.toLocaleString()}</dd>
            </div>
            <div className="bg-gray-700 p-3 rounded-lg">
              <dt className="text-gray-400 text-xs uppercase tracking-wide">CPU Migrations</dt>
              <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.migrations.toLocaleString()}</dd>
            </div>
          </div>
          <div className="text-gray-400 text-sm">
            Active Threads: <span className="text-white">{run.contextSwitchStats.uniqueThreads}</span>
            <span> · Avg Switch Interval: <span className="text-white">{run.contextSwitchStats.avgSwitchIntervalMs.toFixed(2)}ms</span></span>
          </div>
        </div>

        {/* Hotspot Table */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Hotspots</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600 inline-block" /> CPU work</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-700 inline-block" /> sync</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-600 inline-block" /> wait/sleep</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Symbol</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-36">Self %</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-20">Total %</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-20" title="Number of perf samples attributed to this symbol">Samples</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {hotspots.map((hotspot, index) => {
                  const kind = classifySymbol(hotspot.symbol);
                  const displaySym = demangleSymbol(hotspot.symbol);
                  return (
                    <tr key={index} className={`${kind === 'sleep' ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2 text-xs font-mono text-gray-200 max-w-md">
                        <div className="flex items-start gap-1 flex-wrap">
                          <span className="break-all">{displaySym}</span>
                          <SymbolBadge kind={kind} />
                        </div>
                        {hotspot.file && (
                          <div className="text-gray-500 text-xs mt-0.5 font-sans">
                            {hotspot.file}{hotspot.line ? `:${hotspot.line}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <SelfPctBar pct={hotspot.selfPct} kind={kind} maxPct={maxSelfPct} />
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-300">{hotspot.totalPct.toFixed(2)}%</td>
                      <td className="px-3 py-2 text-sm text-gray-400">{hotspot.callCount.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-gray-600 text-xs mt-3">
            "Samples" = perf sampling hits, proportional to time spent. Bar width relative to top symbol. Dimmed rows are blocking/sleep symbols.
          </p>
        </div>

        {/* Optimization Suggestions */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-1">Optimization Suggestions</h3>
          <p className="text-gray-500 text-sm mb-4">Automated analysis based on profiling data.</p>
          <div className="space-y-4">
            {DEMO_SUGGESTIONS.map((suggestion, index) => (
              <div
                key={index}
                className={`rounded-lg p-4 border-l-4 ${
                  suggestion.impact === 'high'
                    ? 'bg-red-950/40 border-red-600'
                    : suggestion.impact === 'medium'
                    ? 'bg-yellow-950/40 border-yellow-600'
                    : 'bg-green-950/30 border-green-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 text-xs rounded font-semibold uppercase ${
                      suggestion.impact === 'high'
                        ? 'bg-red-800 text-red-200'
                        : suggestion.impact === 'medium'
                        ? 'bg-yellow-800 text-yellow-200'
                        : 'bg-green-800 text-green-200'
                    }`}
                  >
                    {suggestion.impact}
                  </span>
                  {suggestion.symbol && (
                    <code className="text-gray-300 text-xs bg-gray-900 px-2 py-0.5 rounded">{suggestion.symbol}</code>
                  )}
                  {suggestion.file && (
                    <span className="text-gray-500 text-xs">
                      {suggestion.file}{suggestion.line ? `:${suggestion.line}` : ''}
                    </span>
                  )}
                </div>
                <p className="text-white text-sm mb-2">
                  <span className="text-gray-400 font-medium">Problem: </span>{suggestion.problem}
                </p>
                <p className="text-gray-300 text-sm">
                  <span className="text-gray-400 font-medium">Fix: </span>{suggestion.fix}
                </p>
                {suggestion.estimatedSpeedup && (
                  <p className="text-green-400 text-xs mt-2 font-mono">
                    Est. speedup: {suggestion.estimatedSpeedup}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-800 rounded-lg p-8 text-center">
          <h3 className="text-2xl font-bold text-white mb-3">Want this for your project?</h3>
          <p className="text-gray-300 mb-6 max-w-xl mx-auto">
            Add one GitHub Actions step. Get flamegraphs, hardware counters, and optimization suggestions on every PR. Free during beta.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              to="/"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition"
            >
              Get Started Free
            </Link>
            <a
              href="https://github.com/SaschaKohler/realbench"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 py-10 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-500">
          <span>&copy; {new Date().getFullYear()} RealBench</span>
          <div className="flex gap-6">
            <a href="https://github.com/SaschaKohler/realbench" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 transition">GitHub</a>
            <a href="mailto:support@sascha-kohler.at" className="hover:text-gray-300 transition">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
