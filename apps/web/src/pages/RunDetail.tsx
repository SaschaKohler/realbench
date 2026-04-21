import { Link, useParams } from 'react-router-dom';
import { useRun } from '../lib/api';

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
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">Profiling Run</h2>
          <p className="text-gray-400 font-mono">{run?.commitSha}</p>
        </div>

        {run?.error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold mb-2 text-red-200">Profiling Failed</h3>
            <p className="text-red-100 font-mono text-sm">{run.error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Run Details</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-gray-400 text-sm">Branch</dt>
                <dd className="text-white">{run?.branch}</dd>
              </div>
              <div>
                <dt className="text-gray-400 text-sm">Build Type</dt>
                <dd className="text-white">{run?.buildType}</dd>
              </div>
              <div>
                <dt className="text-gray-400 text-sm">Status</dt>
                <dd className={`${run?.error ? 'text-red-400' : 'text-white'}`}>
                  {run?.status}{run?.error && ' (with errors)'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400 text-sm">Duration</dt>
                <dd className="text-white">{run?.durationMs ? `${run.durationMs}ms` : 'N/A'}</dd>
              </div>
              {/* P0: Profiling Mode */}
              <div>
                <dt className="text-gray-400 text-sm">Profiling Mode</dt>
                <dd className="text-white">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${
                    run?.profilingMode === 'stat' 
                      ? 'bg-purple-900 text-purple-200' 
                      : 'bg-blue-900 text-blue-200'
                  }`}>
                    {run?.profilingMode || 'sampling'}
                  </span>
                </dd>
              </div>
              {/* P0: CPU Utilization */}
              {run?.cpuUtilizationPercent !== null && (
                <div>
                  <dt className="text-gray-400 text-sm">CPU Utilization</dt>
                  <dd className="text-white">{run.cpuUtilizationPercent}%</dd>
                </div>
              )}
              {/* P0: Time Elapsed */}
              {run?.timeElapsedSeconds !== null && (
                <div>
                  <dt className="text-gray-400 text-sm">Time Elapsed</dt>
                  <dd className="text-white">{run.timeElapsedSeconds}s</dd>
                </div>
              )}
            </dl>
          </div>

          {run?.flamegraphUrl && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-4">Flamegraph</h3>
              <a
                href={run.flamegraphUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                View Flamegraph
              </a>
            </div>
          )}
        </div>

        {/* P0/P1: Hardware Counter Results */}
        {run?.counters && run.counters.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold mb-4">Hardware Performance Counters</h3>
            <table className="min-w-full divide-y divide-gray-700">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Counter
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Value
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Per Unit
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Unit
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {run.counters.map((counter: any, index: number) => (
                  <tr key={index}>
                    <td className="px-4 py-2 text-sm font-mono">{counter.name}</td>
                    <td className="px-4 py-2 text-sm">{counter.value.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm">{counter.unitRatio?.toFixed(2) || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-400">{counter.unitName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {run.isStatMode && run.counters.length >= 2 && (
              <div className="mt-4 p-4 bg-gray-700 rounded">
                <h4 className="font-semibold mb-2">Calculated Metrics</h4>
                <div className="grid grid-cols-2 gap-4">
                  {(() => {
                    const cycles = run.counters.find((c: any) => c.name === 'cycles')?.value || 0;
                    const instructions = run.counters.find((c: any) => c.name === 'instructions')?.value || 0;
                    const l1Misses = run.counters.find((c: any) => c.name === 'L1-dcache-load-misses')?.value || 0;
                    const l1Loads = run.counters.find((c: any) => c.name === 'L1-dcache-loads')?.value || 0;
                    const llcMisses = run.counters.find((c: any) => c.name === 'LLC-load-misses')?.value || 0;
                    const llcLoads = run.counters.find((c: any) => c.name === 'LLC-loads')?.value || 0;
                    return (
                      <>
                        {instructions > 0 && (
                          <div>
                            <dt className="text-gray-400 text-sm">IPC (Instructions per Cycle)</dt>
                            <dd className="text-white font-mono">{(instructions / cycles).toFixed(2)}</dd>
                          </div>
                        )}
                        {l1Loads > 0 && (
                          <div>
                            <dt className="text-gray-400 text-sm">L1 Data Cache Miss Rate</dt>
                            <dd className="text-white font-mono">{((l1Misses / l1Loads) * 100).toFixed(2)}%</dd>
                          </div>
                        )}
                        {llcLoads > 0 && (
                          <div>
                            <dt className="text-gray-400 text-sm">LLC Miss Rate</dt>
                            <dd className="text-white font-mono">{((llcMisses / llcLoads) * 100).toFixed(2)}%</dd>
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

        {/* P1b: Context Switch Tracing */}
        {run?.hasContextSwitchData && run.contextSwitchStats && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold mb-4">Context Switch Analysis</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-gray-700 p-3 rounded">
                <dt className="text-gray-400 text-sm">Total Switches</dt>
                <dd className="text-white text-lg font-mono">{run.contextSwitchStats.totalSwitches?.toLocaleString()}</dd>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <dt className="text-gray-400 text-sm">Voluntary</dt>
                <dd className="text-white text-lg font-mono">{run.contextSwitchStats.voluntarySwitches?.toLocaleString()}</dd>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <dt className="text-gray-400 text-sm">Involuntary</dt>
                <dd className="text-white text-lg font-mono">{run.contextSwitchStats.involuntarySwitches?.toLocaleString()}</dd>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <dt className="text-gray-400 text-sm">CPU Migrations</dt>
                <dd className="text-white text-lg font-mono">{run.contextSwitchStats.migrations?.toLocaleString()}</dd>
              </div>
            </div>
            {run.contextSwitchStats.uniqueThreads > 0 && (
              <div className="mt-2 text-gray-400 text-sm">
                Active Threads: <span className="text-white">{run.contextSwitchStats.uniqueThreads}</span>
                {run.contextSwitchStats.avgSwitchIntervalMs > 0 && (
                  <span> • Avg Switch Interval: <span className="text-white">{run.contextSwitchStats.avgSwitchIntervalMs.toFixed(2)}ms</span></span>
                )}
              </div>
            )}
          </div>
        )}

        {run?.suggestions && run.suggestions.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Optimization Suggestions</h3>
            <div className="space-y-4">
              {run.suggestions.map((suggestion: any, index: number) => (
                <div key={index} className="border-l-4 border-blue-500 pl-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        suggestion.impact === 'high'
                          ? 'bg-red-900 text-red-200'
                          : suggestion.impact === 'medium'
                          ? 'bg-yellow-900 text-yellow-200'
                          : 'bg-green-900 text-green-200'
                      }`}
                    >
                      {suggestion.impact.toUpperCase()}
                    </span>
                    <span className="text-gray-400 font-mono text-sm">{suggestion.symbol}</span>
                  </div>
                  <p className="text-white mb-2">
                    <strong>Problem:</strong> {suggestion.problem}
                  </p>
                  <p className="text-gray-300">
                    <strong>Fix:</strong> {suggestion.fix}
                  </p>
                  {suggestion.estimatedSpeedup && (
                    <p className="text-green-400 text-sm mt-2">
                      Estimated speedup: {suggestion.estimatedSpeedup}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {run?.hotspots && run.hotspots.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 mt-6">
            <h3 className="text-xl font-semibold mb-4">Hotspots</h3>
            <table className="min-w-full divide-y divide-gray-700">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Symbol
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Self %
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Total %
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                    Calls
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {run.hotspots.map((hotspot: any, index: number) => (
                  <tr key={index}>
                    <td className="px-4 py-2 text-sm font-mono">{hotspot.symbol}</td>
                    <td className="px-4 py-2 text-sm">{hotspot.selfPct.toFixed(2)}%</td>
                    <td className="px-4 py-2 text-sm">{hotspot.totalPct.toFixed(2)}%</td>
                    <td className="px-4 py-2 text-sm">{hotspot.callCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
