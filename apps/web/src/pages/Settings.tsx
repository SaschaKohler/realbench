import { useState } from 'react';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../lib/api';
import Navigation from '../components/layout/Navigation';

export default function Settings() {
  const { data, isLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();
  
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<{ key: string; label: string } | null>(null);
  const [formData, setFormData] = useState({
    label: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createApiKey.mutateAsync(formData);
    setNewKey(result.data);
    setShowCreateForm(false);
    setFormData({ label: '' });
  };

  const handleDelete = async () => {
    if (keyToDelete) {
      await deleteApiKey.mutateAsync(keyToDelete);
      setKeyToDelete(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-gray-900">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-white mb-8">Settings</h1>

        {/* API Keys Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">API Keys</h2>
              <p className="text-gray-400 text-sm mt-1">
                Generate API keys for GitHub Actions and CI/CD integrations
              </p>
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Generate API Key
            </button>
          </div>

          {/* New Key Display */}
          {newKey && (
            <div className="mb-6 p-4 bg-green-900/20 border border-green-700 rounded-lg">
              <h3 className="text-green-400 font-semibold mb-2">🔑 New API Key Generated</h3>
              <div className="bg-gray-900 p-3 rounded font-mono text-sm text-green-300 break-all mb-3">
                {newKey.key}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(newKey.key)}
                  className="px-3 py-1 bg-green-700 text-white rounded hover:bg-green-600 text-sm"
                >
                  Copy Key
                </button>
                <button
                  onClick={() => setNewKey(null)}
                  className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                >
                  Dismiss
                </button>
              </div>
              <p className="text-yellow-400 text-xs mt-2">
                ⚠️ Save this key securely. It won't be shown again.
              </p>
            </div>
          )}

          {/* Create API Key Form */}
          {showCreateForm && (
            <div className="mb-6 p-4 bg-gray-700 rounded-lg">
              <h3 className="text-white font-semibold mb-3">Generate New API Key</h3>
              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Label (optional)</label>
                  <input
                    type="text"
                    value={formData.label}
                    onChange={(e) => setFormData({ label: e.target.value })}
                    placeholder="e.g., Production CI, Staging, etc."
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createApiKey.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600"
                  >
                    {createApiKey.isPending ? 'Generating...' : 'Generate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* API Keys List */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading API keys...</div>
          ) : data?.data?.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No API keys yet. Generate one to get started with GitHub Actions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data?.data?.map((apiKey: any) => (
                <div
                  key={apiKey.id}
                  className="flex items-center justify-between p-4 bg-gray-700 rounded-lg"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-white font-medium">{apiKey.label}</span>
                      <span className="text-xs text-gray-400">
                        Created {new Date(apiKey.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Key ID: {apiKey.id}
                    </div>
                  </div>
                  <button
                    onClick={() => setKeyToDelete(apiKey.id)}
                    className="p-2 text-gray-400 hover:text-red-400 transition"
                    title="Delete API key"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GitHub Actions Setup Guide */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">GitHub Actions Setup</h2>
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-white font-semibold mb-2">1. Add Repository Secrets</h3>
              <p className="text-sm mb-2">
                In your GitHub repository, go to Settings → Secrets and variables → Actions and add:
              </p>
              <div className="bg-gray-900 p-3 rounded font-mono text-sm">
                <div>REALBENCH_API_KEY: Your API key from above</div>
                <div>REALBENCH_PROJECT_ID: Your project UUID</div>
              </div>
            </div>
            
            <div>
              <h3 className="text-white font-semibold mb-2">2. Add Workflow File</h3>
              <p className="text-sm mb-2">
                Create `.github/workflows/realbench.yml` in your repository:
              </p>
              <div className="bg-gray-900 p-3 rounded text-xs overflow-x-auto">
                <pre>{`name: RealBench Profiling

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  profile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build
        run: |
          # Your build commands here
          # e.g., cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
          # cmake --build build --parallel
      
      - name: Upload to RealBench
        run: |
          curl -F "binary=@build/your_binary" \\
               -F "projectId=\${{ secrets.REALBENCH_PROJECT_ID }}" \\
               -F "commitSha=\${{ github.sha }}" \\
               -F "branch=\${{ github.head_ref || github.ref_name }}" \\
               -F "buildType=release" \\
               -H "Authorization: Bearer \${{ secrets.REALBENCH_API_KEY }}" \\
               "https://api.realbench.dev/api/v1/profile"`}</pre>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {keyToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold mb-4">Delete API Key</h3>
            <p className="text-gray-300 mb-6">
              Are you sure you want to delete this API key? This will immediately revoke access for any applications using this key.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setKeyToDelete(null)}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteApiKey.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-600"
              >
                {deleteApiKey.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
