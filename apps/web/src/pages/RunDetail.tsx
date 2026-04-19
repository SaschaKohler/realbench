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
