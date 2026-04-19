import { useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProjectRuns, useProfileBinary } from '../lib/api';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useProjectRuns(id!);
  const { mutate: uploadBinary, isPending: isUploading, isSuccess, error } = useProfileBinary();

  const [commitSha, setCommitSha] = useState('');
  const [branch, setBranch] = useState('main');
  const [buildType, setBuildType] = useState<'release' | 'debug'>('release');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !commitSha || !id) return;
    uploadBinary({
      projectId: id,
      commitSha,
      branch,
      buildType,
      binary: selectedFile,
    });
  };

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

        {/* Upload Form */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">New Profiling Run</h2>
          <form onSubmit={handleUpload} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Commit SHA</label>
              <input
                type="text"
                value={commitSha}
                onChange={(e) => setCommitSha(e.target.value)}
                placeholder="abc1234"
                required
                minLength={7}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Branch</label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                required
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Build Type</label>
              <select
                value={buildType}
                onChange={(e) => setBuildType(e.target.value as 'release' | 'debug')}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="release">Release</option>
                <option value="debug">Debug</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Binary</label>
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                required
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 file:mr-3 file:bg-gray-600 file:border-0 file:text-white file:rounded file:px-2 file:py-1"
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-4">
              <button
                type="submit"
                disabled={isUploading || !selectedFile || !commitSha}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-medium transition-colors"
              >
                {isUploading ? 'Uploading...' : 'Start Profiling'}
              </button>
              {isSuccess && <span className="text-green-400 text-sm">✓ Job enqueued!</span>}
              {error && <span className="text-red-400 text-sm">Error: {(error as Error).message}</span>}
            </div>
          </form>
        </div>

        <h2 className="text-3xl font-bold text-white mb-8">Profiling Runs</h2>

        {isLoading ? (
          <div className="text-center py-12">Loading...</div>
        ) : (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Commit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Branch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Build Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {data?.runs?.map((run: any) => (
                  <tr
                    key={run.id}
                    className="hover:bg-gray-750 cursor-pointer"
                    onClick={() => (window.location.href = `/runs/${run.id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">
                      {run.commitSha.substring(0, 8)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{run.branch}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{run.buildType}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          run.status === 'done'
                            ? 'bg-green-900 text-green-200'
                            : run.status === 'failed'
                            ? 'bg-red-900 text-red-200'
                            : run.status === 'processing'
                            ? 'bg-yellow-900 text-yellow-200'
                            : 'bg-gray-700 text-gray-200'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
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
