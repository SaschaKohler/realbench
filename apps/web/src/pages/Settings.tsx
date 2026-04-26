import { useState } from 'react';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../lib/api';
import Navigation from '../components/layout/Navigation';

type WorkflowLang = 'cpp' | 'go' | 'rust';

const WORKFLOW_TEMPLATES: Record<WorkflowLang, string> = {
  cpp: `# RealBench Profiling — C++ GitHub Action
name: RealBench Profiling

on:
  push:
    branches: [main, master]
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      profiling_mode:
        description: 'Profiling mode'
        required: true
        default: 'both'
        type: choice
        options:
          - sampling
          - stat
          - both

jobs:
  profile-sampling:
    name: Profile (Sampling Mode)
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    if: github.event.inputs.profiling_mode == null || github.event.inputs.profiling_mode == 'sampling' || github.event.inputs.profiling_mode == 'both'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y cmake build-essential

      - name: Build
        run: |
          cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
          cmake --build build --parallel

      - name: Upload to RealBench (Sampling)
        id: realbench
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
          REALBENCH_PROJECT_ID: \${{ secrets.REALBENCH_PROJECT_ID }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          BINARY_PATH="build/bin/your-binary"

          PROFILING_OPTIONS='{"mode":"sampling","durationSeconds":30,"frequencyHz":99}'

          RESPONSE=$(curl -sf --show-error \\
            -F "binary=@\${BINARY_PATH}" \\
            -F "projectId=\${REALBENCH_PROJECT_ID}" \\
            -F "commitSha=\${{ github.sha }}" \\
            -F "branch=\${{ github.head_ref || github.ref_name }}" \\
            -F "buildType=auto" \\
            -F "profilingOptions=\${PROFILING_OPTIONS}" \\
            -F "githubRepo=\${{ github.repository }}" \\
            \${PR_NUMBER:+-F "githubPrNumber=\${PR_NUMBER}"} \\
            \${PR_NUMBER:+-F "githubToken=\${GITHUB_TOKEN}"} \\
            -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
            "https://realbench-api.fly.dev/api/v1/profile")

          RUN_ID=$(echo "\${RESPONSE}" | jq -r '.runId')
          echo "run_id=\${RUN_ID}" >> "\$GITHUB_OUTPUT"
          echo "✅ Sampling run enqueued: \${RUN_ID}"

      - name: Wait for sampling result
        if: steps.realbench.outputs.run_id != ''
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
        run: |
          RUN_ID="\${{ steps.realbench.outputs.run_id }}"
          for i in $(seq 1 30); do
            STATUS=$(curl -sf -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
              "https://realbench-api.fly.dev/api/v1/runs/\${RUN_ID}" | jq -r '.run.status')
            echo "  attempt \${i}: status=\${STATUS}"
            if [ "\${STATUS}" = "done" ]; then echo "✅ Sampling complete."; exit 0; fi
            if [ "\${STATUS}" = "failed" ]; then echo "❌ Sampling failed."; exit 1; fi
            sleep 10
          done
          echo "⏳ Sampling timed out."

  profile-stat:
    name: Profile (Stat Mode - Hardware Counters)
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    if: github.event.inputs.profiling_mode == null || github.event.inputs.profiling_mode == 'stat' || github.event.inputs.profiling_mode == 'both'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y cmake build-essential

      - name: Build
        run: |
          cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
          cmake --build build --parallel

      - name: Upload to RealBench (Stat Mode)
        id: realbench-stat
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
          REALBENCH_PROJECT_ID: \${{ secrets.REALBENCH_PROJECT_ID }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          BINARY_PATH="build/bin/your-binary"

          PROFILING_OPTIONS='{"mode":"stat","hwCounters":{"cycles":true,"instructions":true,"cache-misses":true,"cache-references":true,"branch-misses":true,"branches":true},"statDetailed":true}'

          RESPONSE=$(curl -sf --show-error \\
            -F "binary=@\${BINARY_PATH}" \\
            -F "projectId=\${REALBENCH_PROJECT_ID}" \\
            -F "commitSha=\${{ github.sha }}" \\
            -F "branch=\${{ github.head_ref || github.ref_name }}" \\
            -F "buildType=auto" \\
            -F "profilingOptions=\${PROFILING_OPTIONS}" \\
            -F "githubRepo=\${{ github.repository }}" \\
            \${PR_NUMBER:+-F "githubPrNumber=\${PR_NUMBER}"} \\
            \${PR_NUMBER:+-F "githubToken=\${GITHUB_TOKEN}"} \\
            -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
            "https://realbench-api.fly.dev/api/v1/profile")

          RUN_ID=$(echo "\${RESPONSE}" | jq -r '.runId')
          echo "run_id=\${RUN_ID}" >> "\$GITHUB_OUTPUT"
          echo "✅ Stat run enqueued: \${RUN_ID}"

      - name: Wait for stat result
        if: steps.realbench-stat.outputs.run_id != ''
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
        run: |
          RUN_ID="\${{ steps.realbench-stat.outputs.run_id }}"
          for i in $(seq 1 30); do
            STATUS=$(curl -sf -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
              "https://realbench-api.fly.dev/api/v1/runs/\${RUN_ID}" | jq -r '.run.status')
            echo "  attempt \${i}: status=\${STATUS}"
            if [ "\${STATUS}" = "done" ]; then echo "✅ Stat profiling complete."; exit 0; fi
            if [ "\${STATUS}" = "failed" ]; then echo "❌ Stat profiling failed."; exit 1; fi
            sleep 10
          done
          echo "⏳ Stat profiling timed out."`,

  go: `# RealBench Profiling — Go GitHub Action
name: RealBench Profiling

on:
  push:
    branches: [main, master]
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      profiling_mode:
        description: 'Profiling mode'
        required: true
        default: 'both'
        type: choice
        options:
          - sampling
          - stat
          - both

jobs:
  profile-sampling:
    name: Profile (Sampling Mode)
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    if: github.event.inputs.profiling_mode == null || github.event.inputs.profiling_mode == 'sampling' || github.event.inputs.profiling_mode == 'both'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Build with debug info
        run: GOEXPERIMENT=framepointer go build -gcflags="-N -l" -o your-binary main.go

      - name: Upload to RealBench (Sampling)
        id: realbench
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
          REALBENCH_PROJECT_ID: \${{ secrets.REALBENCH_PROJECT_ID }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          BINARY_PATH="your-binary"

          PROFILING_OPTIONS='{"mode":"sampling","durationSeconds":30,"frequencyHz":99}'

          RESPONSE=$(curl -sf --show-error \\
            -F "binary=@\${BINARY_PATH}" \\
            -F "projectId=\${REALBENCH_PROJECT_ID}" \\
            -F "commitSha=\${{ github.sha }}" \\
            -F "branch=\${{ github.head_ref || github.ref_name }}" \\
            -F "buildType=auto" \\
            -F "profilingOptions=\${PROFILING_OPTIONS}" \\
            -F "githubRepo=\${{ github.repository }}" \\
            \${PR_NUMBER:+-F "githubPrNumber=\${PR_NUMBER}"} \\
            \${PR_NUMBER:+-F "githubToken=\${GITHUB_TOKEN}"} \\
            -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
            "https://realbench-api.fly.dev/api/v1/profile")

          RUN_ID=$(echo "\${RESPONSE}" | jq -r '.runId')
          echo "run_id=\${RUN_ID}" >> "\$GITHUB_OUTPUT"
          echo "✅ Sampling run enqueued: \${RUN_ID}"

      - name: Wait for sampling result
        if: steps.realbench.outputs.run_id != ''
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
        run: |
          RUN_ID="\${{ steps.realbench.outputs.run_id }}"
          for i in $(seq 1 30); do
            STATUS=$(curl -sf -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
              "https://realbench-api.fly.dev/api/v1/runs/\${RUN_ID}" | jq -r '.run.status')
            echo "  attempt \${i}: status=\${STATUS}"
            if [ "\${STATUS}" = "done" ]; then echo "✅ Sampling complete."; exit 0; fi
            if [ "\${STATUS}" = "failed" ]; then echo "❌ Sampling failed."; exit 1; fi
            sleep 10
          done
          echo "⏳ Sampling timed out."

  profile-stat:
    name: Profile (Stat Mode - Hardware Counters)
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    if: github.event.inputs.profiling_mode == null || github.event.inputs.profiling_mode == 'stat' || github.event.inputs.profiling_mode == 'both'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Build with debug info
        run: GOEXPERIMENT=framepointer go build -gcflags="-N -l" -o your-binary main.go

      - name: Upload to RealBench (Stat Mode)
        id: realbench-stat
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
          REALBENCH_PROJECT_ID: \${{ secrets.REALBENCH_PROJECT_ID }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          BINARY_PATH="your-binary"

          PROFILING_OPTIONS='{"mode":"stat","hwCounters":{"cycles":true,"instructions":true,"cache-misses":true,"cache-references":true,"branch-misses":true,"branches":true},"statDetailed":true}'

          RESPONSE=$(curl -sf --show-error \\
            -F "binary=@\${BINARY_PATH}" \\
            -F "projectId=\${REALBENCH_PROJECT_ID}" \\
            -F "commitSha=\${{ github.sha }}" \\
            -F "branch=\${{ github.head_ref || github.ref_name }}" \\
            -F "buildType=auto" \\
            -F "profilingOptions=\${PROFILING_OPTIONS}" \\
            -F "githubRepo=\${{ github.repository }}" \\
            \${PR_NUMBER:+-F "githubPrNumber=\${PR_NUMBER}"} \\
            \${PR_NUMBER:+-F "githubToken=\${GITHUB_TOKEN}"} \\
            -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
            "https://realbench-api.fly.dev/api/v1/profile")

          RUN_ID=$(echo "\${RESPONSE}" | jq -r '.runId')
          echo "run_id=\${RUN_ID}" >> "\$GITHUB_OUTPUT"
          echo "✅ Stat run enqueued: \${RUN_ID}"

      - name: Wait for stat result
        if: steps.realbench-stat.outputs.run_id != ''
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
        run: |
          RUN_ID="\${{ steps.realbench-stat.outputs.run_id }}"
          for i in $(seq 1 30); do
            STATUS=$(curl -sf -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
              "https://realbench-api.fly.dev/api/v1/runs/\${RUN_ID}" | jq -r '.run.status')
            echo "  attempt \${i}: status=\${STATUS}"
            if [ "\${STATUS}" = "done" ]; then echo "✅ Stat profiling complete."; exit 0; fi
            if [ "\${STATUS}" = "failed" ]; then echo "❌ Stat profiling failed."; exit 1; fi
            sleep 10
          done
          echo "⏳ Stat profiling timed out."`,

  rust: `# RealBench Profiling — Rust GitHub Action
name: RealBench Profiling

on:
  push:
    branches: [main, master]
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      profiling_mode:
        description: 'Profiling mode'
        required: true
        default: 'both'
        type: choice
        options:
          - sampling
          - stat
          - both

jobs:
  profile-sampling:
    name: Profile (Sampling Mode)
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    if: github.event.inputs.profiling_mode == null || github.event.inputs.profiling_mode == 'sampling' || github.event.inputs.profiling_mode == 'both'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Build with debug info
        run: RUSTFLAGS="-g" cargo build --release

      - name: Upload to RealBench (Sampling)
        id: realbench
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
          REALBENCH_PROJECT_ID: \${{ secrets.REALBENCH_PROJECT_ID }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          BINARY_PATH="target/release/your-binary"

          PROFILING_OPTIONS='{"mode":"sampling","durationSeconds":30,"frequencyHz":99}'

          RESPONSE=$(curl -sf --show-error \\
            -F "binary=@\${BINARY_PATH}" \\
            -F "projectId=\${REALBENCH_PROJECT_ID}" \\
            -F "commitSha=\${{ github.sha }}" \\
            -F "branch=\${{ github.head_ref || github.ref_name }}" \\
            -F "buildType=auto" \\
            -F "profilingOptions=\${PROFILING_OPTIONS}" \\
            -F "githubRepo=\${{ github.repository }}" \\
            \${PR_NUMBER:+-F "githubPrNumber=\${PR_NUMBER}"} \\
            \${PR_NUMBER:+-F "githubToken=\${GITHUB_TOKEN}"} \\
            -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
            "https://realbench-api.fly.dev/api/v1/profile")

          RUN_ID=$(echo "\${RESPONSE}" | jq -r '.runId')
          echo "run_id=\${RUN_ID}" >> "\$GITHUB_OUTPUT"
          echo "✅ Sampling run enqueued: \${RUN_ID}"

      - name: Wait for sampling result
        if: steps.realbench.outputs.run_id != ''
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
        run: |
          RUN_ID="\${{ steps.realbench.outputs.run_id }}"
          for i in $(seq 1 30); do
            STATUS=$(curl -sf -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
              "https://realbench-api.fly.dev/api/v1/runs/\${RUN_ID}" | jq -r '.run.status')
            echo "  attempt \${i}: status=\${STATUS}"
            if [ "\${STATUS}" = "done" ]; then echo "✅ Sampling complete."; exit 0; fi
            if [ "\${STATUS}" = "failed" ]; then echo "❌ Sampling failed."; exit 1; fi
            sleep 10
          done
          echo "⏳ Sampling timed out."

  profile-stat:
    name: Profile (Stat Mode - Hardware Counters)
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    if: github.event.inputs.profiling_mode == null || github.event.inputs.profiling_mode == 'stat' || github.event.inputs.profiling_mode == 'both'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Build with debug info
        run: RUSTFLAGS="-g" cargo build --release

      - name: Upload to RealBench (Stat Mode)
        id: realbench-stat
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
          REALBENCH_PROJECT_ID: \${{ secrets.REALBENCH_PROJECT_ID }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          BINARY_PATH="target/release/your-binary"

          PROFILING_OPTIONS='{"mode":"stat","hwCounters":{"cycles":true,"instructions":true,"cache-misses":true,"cache-references":true,"branch-misses":true,"branches":true},"statDetailed":true}'

          RESPONSE=$(curl -sf --show-error \\
            -F "binary=@\${BINARY_PATH}" \\
            -F "projectId=\${REALBENCH_PROJECT_ID}" \\
            -F "commitSha=\${{ github.sha }}" \\
            -F "branch=\${{ github.head_ref || github.ref_name }}" \\
            -F "buildType=auto" \\
            -F "profilingOptions=\${PROFILING_OPTIONS}" \\
            -F "githubRepo=\${{ github.repository }}" \\
            \${PR_NUMBER:+-F "githubPrNumber=\${PR_NUMBER}"} \\
            \${PR_NUMBER:+-F "githubToken=\${GITHUB_TOKEN}"} \\
            -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
            "https://realbench-api.fly.dev/api/v1/profile")

          RUN_ID=$(echo "\${RESPONSE}" | jq -r '.runId')
          echo "run_id=\${RUN_ID}" >> "\$GITHUB_OUTPUT"
          echo "✅ Stat run enqueued: \${RUN_ID}"

      - name: Wait for stat result
        if: steps.realbench-stat.outputs.run_id != ''
        env:
          REALBENCH_API_KEY: \${{ secrets.REALBENCH_API_KEY }}
        run: |
          RUN_ID="\${{ steps.realbench-stat.outputs.run_id }}"
          for i in $(seq 1 30); do
            STATUS=$(curl -sf -H "Authorization: Bearer \${REALBENCH_API_KEY}" \\
              "https://realbench-api.fly.dev/api/v1/runs/\${RUN_ID}" | jq -r '.run.status')
            echo "  attempt \${i}: status=\${STATUS}"
            if [ "\${STATUS}" = "done" ]; then echo "✅ Stat profiling complete."; exit 0; fi
            if [ "\${STATUS}" = "failed" ]; then echo "❌ Stat profiling failed."; exit 1; fi
            sleep 10
          done
          echo "⏳ Stat profiling timed out."`,
};

export default function Settings() {
  const { data, isLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();
  const [workflowLang, setWorkflowLang] = useState<WorkflowLang>('cpp');
  
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
                Create <code className="bg-gray-700 px-1 rounded">.github/workflows/realbench.yml</code> in your repository.
                Replace <code className="bg-gray-700 px-1 rounded">your-binary</code> with your actual binary name/path.
              </p>

              <div className="flex gap-2 mb-3">
                {(['cpp', 'go', 'rust'] as WorkflowLang[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setWorkflowLang(lang)}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${
                      workflowLang === lang
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {lang === 'cpp' ? 'C++' : lang === 'go' ? 'Go' : 'Rust'}
                  </button>
                ))}
              </div>

              <div className="bg-gray-900 p-3 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto">
                <pre className="whitespace-pre">{WORKFLOW_TEMPLATES[workflowLang]}</pre>
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
