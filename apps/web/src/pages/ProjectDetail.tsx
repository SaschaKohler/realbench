import { useState, useRef, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useProject, useProjectRuns, useProfileBinary, useUpdateProject, useDeleteRun } from '../lib/api';

const ESTIMATED_DURATION_MS = 45_000;

function ElapsedProgressBar({ createdAt, status }: { createdAt: string; status: string }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    const tick = () => {
      const elapsed = Date.now() - start;
      setPct(Math.min(99, (elapsed / ESTIMATED_DURATION_MS) * 100));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [createdAt]);

  const color = status === 'pending' ? 'bg-gray-500' : 'bg-yellow-500';

  return (
    <div className="mt-1 w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: projectData } = useProject(id!);
  const { data, isLoading } = useProjectRuns(id!);
  const { mutate: uploadBinary, isPending: isUploading, isSuccess, error } = useProfileBinary();
  const updateProject = useUpdateProject();
  const deleteRun = useDeleteRun();

  const [commitSha, setCommitSha] = useState('');
  const [branch, setBranch] = useState('main');
  const [buildType, setBuildType] = useState<'release' | 'debug'>('release');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Edit project state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  // Delete run state
  const [runToDelete, setRunToDelete] = useState<string | null>(null);

  // P0/P1/P1b: Profiling options state
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [profilingMode, setProfilingMode] = useState<'sampling' | 'stat'>('sampling');
  const [statDetailed, setStatDetailed] = useState(false);
  const [traceContextSwitches, setTraceContextSwitches] = useState(false);
  const [enableCacheCounters, setEnableCacheCounters] = useState(false);
  const [enableTlbCounters, setEnableTlbCounters] = useState(false);

  const handleUpdateName = async () => {
    if (editName.trim() && id) {
      await updateProject.mutateAsync({ projectId: id, name: editName.trim() });
      setIsEditingName(false);
    }
  };

  const handleDeleteRun = async () => {
    if (runToDelete) {
      await deleteRun.mutateAsync(runToDelete);
      setRunToDelete(null);
    }
  };

  const startEditingName = () => {
    setEditName(projectData?.project?.name || '');
    setIsEditingName(true);
  };

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !commitSha || !id) return;
    
    // Build profiling options
    const profilingOptions: import('../lib/api').ProfilingOptionsInput = {
      mode: profilingMode,
      statDetailed,
      traceContextSwitches,
    };
    
    // P1: Add hardware counters if enabled
    if (profilingMode === 'stat' && (enableCacheCounters || enableTlbCounters)) {
      profilingOptions.hwCounters = {
        cycles: true,
        instructions: true,
      };
      
      if (enableCacheCounters) {
        profilingOptions.hwCounters.l1DcacheLoads = true;
        profilingOptions.hwCounters.l1DcacheLoadMisses = true;
        profilingOptions.hwCounters.llcLoads = true;
        profilingOptions.hwCounters.llcLoadMisses = true;
      }
      
      if (enableTlbCounters) {
        profilingOptions.hwCounters.dtlbLoads = true;
        profilingOptions.hwCounters.dtlbLoadMisses = true;
        profilingOptions.hwCounters.itlbLoads = true;
        profilingOptions.hwCounters.itlbLoadMisses = true;
      }
    }
    
    uploadBinary({
      projectId: id,
      commitSha,
      branch,
      buildType,
      binary: selectedFile,
      profilingOptions,
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
        {/* Project Header with Edit */}
        <div className="mb-8">
          {isEditingName ? (
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-3xl font-bold bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                autoFocus
              />
              <button
                onClick={handleUpdateName}
                disabled={updateProject.isPending}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditingName(false)}
                className="px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-white">{projectData?.project?.name || 'Project'}</h1>
              <button
                onClick={startEditingName}
                className="p-2 text-gray-400 hover:text-white opacity-0 hover:opacity-100 transition"
                title="Edit project name"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
            </div>
          )}
          <p className="text-gray-400 mt-1">
            {projectData?.project?.language?.toUpperCase() || ''}
          </p>
        </div>

        {/* Delete Run Confirmation Modal */}
        {runToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold mb-4">Delete Run</h3>
              <p className="text-gray-300 mb-6">
                Are you sure you want to delete this profiling run? This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setRunToDelete(null)}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteRun}
                  disabled={deleteRun.isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-600"
                >
                  {deleteRun.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

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
            {/* Advanced Options Toggle */}
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="text-gray-400 hover:text-white text-sm flex items-center gap-2"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Advanced Profiling Options
              </button>
            </div>

            {/* Advanced Options Panel */}
            {showAdvancedOptions && (
              <>
                {/* P0: Profiling Mode */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Profiling Mode</label>
                  <select
                    value={profilingMode}
                    onChange={(e) => setProfilingMode(e.target.value as 'sampling' | 'stat')}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="sampling">Sampling (Flamegraph)</option>
                    <option value="stat">Stat Mode (Hardware Counters)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {profilingMode === 'sampling' 
                      ? 'Records call stacks for flamegraph visualization' 
                      : 'Counts hardware events (cycles, cache misses, etc.)'}
                  </p>
                </div>

                {/* P0: Stat Mode Options */}
                {profilingMode === 'stat' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="statDetailed"
                      checked={statDetailed}
                      onChange={(e) => setStatDetailed(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="statDetailed" className="text-sm text-gray-300">
                      Detailed output
                    </label>
                  </div>
                )}

                {/* P1: Hardware Counter Presets */}
                {profilingMode === 'stat' && (
                  <>
                    <div className="sm:col-span-2 border-t border-gray-700 pt-4">
                      <h4 className="text-sm font-semibold text-gray-300 mb-3">Hardware Counter Presets</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="cacheCounters"
                            checked={enableCacheCounters}
                            onChange={(e) => setEnableCacheCounters(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                          />
                          <label htmlFor="cacheCounters" className="text-sm text-gray-300">
                            Cache Analysis (L1/LLC)
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="tlbCounters"
                            checked={enableTlbCounters}
                            onChange={(e) => setEnableTlbCounters(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                          />
                          <label htmlFor="tlbCounters" className="text-sm text-gray-300">
                            TLB Analysis (DTLB/ITLB)
                          </label>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* P1b: Context Switch Tracing */}
                <div className="sm:col-span-2 border-t border-gray-700 pt-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="traceContextSwitches"
                      checked={traceContextSwitches}
                      onChange={(e) => setTraceContextSwitches(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="traceContextSwitches" className="text-sm text-gray-300">
                      Trace Context Switches (Multithreading Analysis)
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    Records thread scheduling events and CPU migrations
                  </p>
                </div>
              </>
            )}

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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {data?.runs?.map((run: any) => (
                  <tr
                    key={run.id}
                    className="hover:bg-gray-750 group"
                  >
                    <td
                      className="px-6 py-4 whitespace-nowrap text-sm font-mono cursor-pointer"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      {run.commitSha.substring(0, 8)}
                    </td>
                    <td
                      className="px-6 py-4 whitespace-nowrap text-sm cursor-pointer"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      {run.branch}
                    </td>
                    <td
                      className="px-6 py-4 whitespace-nowrap text-sm cursor-pointer"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      {run.buildType}
                    </td>
                    <td
                      className="px-6 py-4 cursor-pointer"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
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
                      {(run.status === 'pending' || run.status === 'processing') && (
                        <ElapsedProgressBar createdAt={run.createdAt} status={run.status} />
                      )}
                    </td>
                    <td
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 cursor-pointer"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm relative">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('Delete clicked for run:', run.id);
                          setRunToDelete(run.id);
                        }}
                        className="p-2 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition z-10 rounded"
                        title="Delete run"
                        type="button"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
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
