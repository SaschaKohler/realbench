import { Link, useParams } from 'react-router-dom';
import { useRun } from '../lib/api';

const SLEEP_WAIT_SYMBOLS = new Set([
  '__lll_lock_wait',
  '__lll_lock_wait_private',
  '__futex_abstimed_wait_cancelable64',
  '__clock_nanosleep',
  '__pthread_clockjoin_ex',
  '__lll_lock_wake',
  '__lll_lock_wake_private',
  'sem_wait',
  'pthread_cond_wait',
  'epoll_wait',
  'nanosleep',
  'poll',
  'select',
]);

const SYNC_SYMBOLS = new Set([
  'std::mutex::lock()',
  '__pthread_mutex_lock',
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

  // Strip leading return type (e.g. 'double std::generate_canonical<...>(...)')
  name = name.replace(/^[\w:*&<>\s]+?(?=\bstd::|\b[A-Z][\w:]*::)/, '');

  // Collapse long template parameter lists (>40 chars inside <>) to <…>
  name = name.replace(/<[^<>]{40,}>/g, '<…>');

  // Strip discriminator suffix from location like ' @ file.cpp:29 (discriminator 1)'
  return (name + location).replace(/\s*\(discriminator \d+\)/, '');
}

function SymbolBadge({ kind }: { kind: 'sleep' | 'sync' | 'cpu' }) {
  if (kind === 'sleep') {
    return (
      <span title="This symbol represents time a thread spent sleeping or blocked waiting — not CPU work." className="ml-2 px-1.5 py-0.5 text-xs rounded bg-slate-700 text-slate-300 align-middle">
        wait
      </span>
    );
  }
  if (kind === 'sync') {
    return (
      <span title="Synchronization overhead — time spent acquiring locks or waiting on condition variables." className="ml-2 px-1.5 py-0.5 text-xs rounded bg-orange-900 text-orange-300 align-middle">
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

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useRun(id!);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  const run = data?.run;

  const hotspots: any[] = run?.hotspots ?? [];
  const totalSleepPct = hotspots
    .filter((h: any) => classifySymbol(h.symbol) === 'sleep')
    .reduce((sum: number, h: any) => sum + h.selfPct, 0);
  const totalSyncPct = hotspots
    .filter((h: any) => classifySymbol(h.symbol) === 'sync')
    .reduce((sum: number, h: any) => sum + h.selfPct, 0);
  const totalCpuPct = hotspots
    .filter((h: any) => classifySymbol(h.symbol) === 'cpu')
    .reduce((sum: number, h: any) => sum + h.selfPct, 0);

  const counters: any[] = run?.counters ?? [];
  const nonZeroCounters = counters.filter((c: any) => c.value > 0);

  return (
    <div className="min-h-screen bg-gray-900">
      <nav className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to="/" className="text-2xl font-bold text-white hover:text-gray-300">
              ← RealBench
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">Profiling Run</h2>
          <p className="text-gray-400 font-mono text-sm">{run?.commitSha}</p>
        </div>

        {run?.error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-6 mb-6">
            <h3 className="text-xl font-semibold mb-2 text-red-200">Profiling Failed</h3>
            <p className="text-red-100 font-mono text-sm">{run.error}</p>
          </div>
        )}

        {/* Run summary */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Run Details</h3>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3">
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Branch</dt>
              <dd className="text-white font-mono text-sm mt-0.5">{run?.branch}</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Build Type</dt>
              <dd className="text-white text-sm mt-0.5 capitalize">{run?.buildType}</dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Status</dt>
              <dd className={`text-sm mt-0.5 ${run?.error ? 'text-red-400' : 'text-green-400'}`}>
                {run?.status}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Wall Time</dt>
              <dd className="text-white text-sm mt-0.5">
                {run?.timeElapsedSeconds != null
                  ? `${run.timeElapsedSeconds}s`
                  : run?.durationMs
                  ? `${(run.durationMs / 1000).toFixed(2)}s`
                  : 'N/A'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Mode</dt>
              <dd className="mt-0.5">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  run?.profilingMode === 'stat'
                    ? 'bg-purple-900 text-purple-200'
                    : 'bg-blue-900 text-blue-200'
                }`}>
                  {run?.profilingMode || 'sampling'}
                </span>
              </dd>
            </div>
            {run?.cpuUtilizationPercent != null && run.cpuUtilizationPercent > 0 && (
              <div>
                <dt className="text-gray-400 text-xs uppercase tracking-wide">CPUs Utilized</dt>
                <dd className="text-white text-sm mt-0.5">{(run.cpuUtilizationPercent / 100).toFixed(2)}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Flamegraph – full width, embedded inline */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              {run?.profilingMode === 'stat' ? 'Performance Counter Chart' : 'Flamegraph'}
            </h3>
            {run?.flamegraphUrl && (
              <a
                href={run.flamegraphUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-medium transition-colors"
              >
                Open full size ↗
              </a>
            )}
          </div>
          {run?.flamegraphUrl ? (
            <>
              <p className="text-gray-400 text-sm mb-3">
                {run.profilingMode === 'stat'
                  ? 'Hardware counter values with proportional bars. IPC and cache miss rate derived metrics shown below.'
                  : 'Interactive call stack visualization. Wider frames = more CPU time. Click to zoom · double-click to reset · use search box to highlight.'}
              </p>
              <div className="rounded-lg overflow-hidden border border-gray-700" style={{ height: '420px' }}>
                <object
                  data={run.flamegraphUrl}
                  type="image/svg+xml"
                  className="w-full h-full"
                  aria-label={run.profilingMode === 'stat' ? 'Performance counter chart' : 'Flamegraph'}
                >
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    SVG could not be embedded.{' '}
                    <a href={run.flamegraphUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline ml-1">
                      Open directly ↗
                    </a>
                  </div>
                </object>
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-sm">No visualization available yet.</p>
          )}
        </div>

        {/* Thread efficiency summary (sampling mode only) */}
        {hotspots.length > 0 && run?.profilingMode !== 'stat' && (
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
                <div className={`text-2xl font-bold ${totalSleepPct > 30 ? 'text-red-400' : totalSleepPct > 10 ? 'text-yellow-400' : 'text-slate-400'}`}>
                  {totalSleepPct.toFixed(1)}%
                </div>
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
            {totalSleepPct > 20 && (
              <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
                ⚠ {totalSleepPct.toFixed(1)}% of sampled time is threads sleeping or waiting on locks. The primary bottleneck is synchronization contention, not CPU throughput.
              </div>
            )}
          </div>
        )}

        {/* Hardware Counters (stat mode) */}
        {nonZeroCounters.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Hardware Performance Counters</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {nonZeroCounters.map((counter: any, index: number) => (
                <div key={index} className="bg-gray-700 rounded-lg p-3">
                  <div className="text-gray-400 text-xs font-mono mb-1">{counter.name}</div>
                  <div className="text-white font-mono text-sm font-medium">{counter.value.toLocaleString()}</div>
                  {counter.comment && (
                    <div className="text-gray-500 text-xs mt-0.5">{counter.comment}</div>
                  )}
                </div>
              ))}
            </div>
            {run?.isStatMode && counters.length >= 2 && (
              <div className="p-4 bg-gray-700 rounded-lg">
                <h4 className="font-semibold text-sm mb-3 text-gray-300">Derived Metrics</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {(() => {
                    const byName = Object.fromEntries(counters.map((c: any) => [c.name, c.value]));
                    const cycles = byName['cycles'] || 0;
                    const instructions = byName['instructions'] || 0;
                    const cacheMisses = byName['cache-misses'] || 0;
                    const cacheRefs = byName['cache-references'] || 0;
                    const l1Misses = byName['L1-dcache-load-misses'] || 0;
                    const l1Loads = byName['L1-dcache-loads'] || 0;
                    const llcMisses = byName['LLC-load-misses'] || 0;
                    const llcLoads = byName['LLC-loads'] || 0;
                    const ipc = cycles > 0 && instructions > 0 ? instructions / cycles : null;
                    const l3MissRate = cacheRefs > 0 ? (cacheMisses / cacheRefs) * 100 : null;
                    const l1MissRate = l1Loads > 0 ? (l1Misses / l1Loads) * 100 : null;
                    const llcMissRate = llcLoads > 0 ? (llcMisses / llcLoads) * 100 : null;
                    return (
                      <>
                        {ipc !== null && (
                          <div>
                            <div className="text-gray-400 text-xs">IPC</div>
                            <div className={`font-mono text-lg font-bold ${ipc < 1.0 ? 'text-red-400' : ipc > 3.0 ? 'text-green-400' : 'text-white'}`}>
                              {ipc.toFixed(2)}
                            </div>
                            <div className="text-gray-500 text-xs">
                              {ipc < 1.0 ? 'memory/branch bound' : ipc > 3.0 ? 'compute efficient' : 'moderate'}
                            </div>
                          </div>
                        )}
                        {l1MissRate !== null && (
                          <div>
                            <div className="text-gray-400 text-xs">L1 Miss Rate</div>
                            <div className={`font-mono text-lg font-bold ${l1MissRate > 5 ? 'text-red-400' : 'text-green-400'}`}>
                              {l1MissRate.toFixed(2)}%
                            </div>
                            <div className="text-gray-500 text-xs">L1 data cache</div>
                          </div>
                        )}
                        {l3MissRate !== null && (
                          <div>
                            <div className="text-gray-400 text-xs">L3 Miss Rate</div>
                            <div className={`font-mono text-lg font-bold ${l3MissRate > 10 ? 'text-red-400' : l3MissRate > 3 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {l3MissRate.toFixed(2)}%
                            </div>
                            <div className="text-gray-500 text-xs">cache-refs basis</div>
                          </div>
                        )}
                        {llcMissRate !== null && (
                          <div>
                            <div className="text-gray-400 text-xs">LLC Miss Rate</div>
                            <div className={`font-mono text-lg font-bold ${llcMissRate > 10 ? 'text-red-400' : 'text-green-400'}`}>
                              {llcMissRate.toFixed(2)}%
                            </div>
                            <div className="text-gray-500 text-xs">last-level cache</div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Context Switch Analysis */}
        {run?.hasContextSwitchData && run.contextSwitchStats && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Context Switch Analysis</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-gray-700 p-3 rounded-lg">
                <dt className="text-gray-400 text-xs uppercase tracking-wide">Total Switches</dt>
                <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.totalSwitches?.toLocaleString()}</dd>
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <dt className="text-gray-400 text-xs uppercase tracking-wide">Voluntary</dt>
                <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.voluntarySwitches?.toLocaleString()}</dd>
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <dt className="text-gray-400 text-xs uppercase tracking-wide">Involuntary</dt>
                <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.involuntarySwitches?.toLocaleString()}</dd>
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <dt className="text-gray-400 text-xs uppercase tracking-wide">CPU Migrations</dt>
                <dd className="text-white text-xl font-mono mt-1">{run.contextSwitchStats.migrations?.toLocaleString()}</dd>
              </div>
            </div>
            {run.contextSwitchStats.uniqueThreads > 0 && (
              <div className="text-gray-400 text-sm">
                Active Threads: <span className="text-white">{run.contextSwitchStats.uniqueThreads}</span>
                {run.contextSwitchStats.avgSwitchIntervalMs > 0 && (
                  <span> · Avg Switch Interval: <span className="text-white">{run.contextSwitchStats.avgSwitchIntervalMs.toFixed(2)}ms</span></span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Hotspot Table */}
        {hotspots.length > 0 && (() => { const maxSelfPct = Math.max(...hotspots.map((h: any) => h.selfPct), 1); return (
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-20" title="Number of perf samples attributed to this symbol, not actual call count">Samples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {hotspots.map((hotspot: any, index: number) => {
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
              "Samples" = perf sampling hits, proportional to time spent. Bar width relative to top symbol. Dimmed rows are blocking/sleep symbols — threads were not consuming CPU.
            </p>
          </div>
        ); })()}

        {/* LLM Optimization Suggestions */}
        {run?.suggestions && run.suggestions.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-1">Optimization Suggestions</h3>
            <p className="text-gray-500 text-sm mb-4">AI-generated analysis based on profiling data.</p>
            <div className="space-y-4">
              {run.suggestions.map((suggestion: any, index: number) => (
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
        )}
      </main>
    </div>
  );
}
