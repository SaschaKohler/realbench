import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useJoinWaitlist } from '../lib/api';

const features = [
  {
    icon: '🔥',
    title: 'Flamegraph Visualization',
    desc: 'Interactive SVG flamegraphs show exactly where your program spends time — zoom, hover, and explore the call stack without leaving the browser.',
  },
  {
    icon: '📊',
    title: 'Hardware Counter Profiling',
    desc: 'Go beyond wall-clock time. Measure CPU cycles, cache misses, branch mispredictions, TLB misses, and L1/L2/LLC hit rates via Linux perf_event_open.',
  },
  {
    icon: '🤖',
    title: 'AI-Powered Suggestions',
    desc: 'Claude analyses your hotspot data and generates ranked, file-and-line-specific optimization suggestions — with estimated speedup and concrete code fixes.',
  },
  {
    icon: '📉',
    title: 'Regression Detection',
    desc: 'Compare any two runs side-by-side. RealBench detects performance regressions across commits and posts the diff directly to your GitHub PR.',
  },
  {
    icon: '⚡',
    title: 'CI/CD Native',
    desc: 'One GitHub Actions step. No servers to manage, no agents to install. Push your binary and get profiling results posted back to the PR within minutes.',
  },
  {
    icon: '🔄',
    title: 'Context Switch Tracing',
    desc: 'Diagnose scheduler contention and lock-induced thrashing. Trace voluntary and involuntary context switches per thread with microsecond timestamps.',
  },
];

const useCases = [
  {
    lang: 'C++',
    color: 'blue',
    example: `# .github/workflows/realbench.yml
- name: Profile binary
  uses: realbench/action@v1
  with:
    binary: ./build/my_app
    api-key: \${{ secrets.REALBENCH_API_KEY }}
    mode: sampling          # or: stat
    duration: 30`,
    story: 'Catch allocator hotspots, template instantiation bloat, and STL overhead. Compare Debug vs Release builds automatically on every PR.',
  },
  {
    lang: 'Rust',
    color: 'orange',
    example: `# Profile a release build
- run: cargo build --release
- name: Profile
  uses: realbench/action@v1
  with:
    binary: ./target/release/my_bin
    api-key: \${{ secrets.REALBENCH_API_KEY }}
    hw-counters: cycles,cache-misses`,
    story: 'Find async runtime overhead, unexpected Arc clones, and monomorphization costs. Hardware counters expose cache behaviour invisible to time-based profiling.',
  },
  {
    lang: 'Go',
    color: 'cyan',
    example: `# Build a static binary first
- run: CGO_ENABLED=0 go build -o my_service .
- name: Profile
  uses: realbench/action@v1
  with:
    binary: ./my_service
    api-key: \${{ secrets.REALBENCH_API_KEY }}
    trace-context-switches: true`,
    story: 'Profile goroutine scheduler interactions, GC pauses, and syscall overhead. Context-switch tracing reveals scheduler contention in high-concurrency workloads.',
  },
];

const howItWorks = [
  { step: '1', title: 'Add the GitHub Action', desc: 'One YAML block in your workflow. Point it at your compiled binary and your RealBench API key.' },
  { step: '2', title: 'Binary uploaded & queued', desc: 'RealBench stores your binary on Cloudflare R2 and queues a profiling job on dedicated Linux hardware.' },
  { step: '3', title: 'perf_event_open profiling', desc: 'The C++ sampling profiler attaches to your process via Linux perf_event_open — no code changes, no recompilation.' },
  { step: '4', title: 'Flamegraph + AI analysis', desc: 'An interactive SVG flamegraph is generated. Claude analyses the hotspots and produces ranked optimization suggestions.' },
  { step: '5', title: 'Results posted to PR', desc: 'A comment appears on your GitHub PR with the top hotspots, suggestions, and a link to the full dashboard.' },
];

const LANGUAGES = ['C++', 'Rust', 'Go', 'Other'] as const;

export default function LandingPage() {
  const [form, setForm] = useState({ email: '', name: '', useCase: '', language: '' });
  const [submitted, setSubmitted] = useState(false);
  const join = useJoinWaitlist();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await join.mutateAsync({
        email: form.email,
        name: form.name || undefined,
        useCase: form.useCase || undefined,
        language: form.language.toLowerCase().replace('c++', 'cpp') || undefined,
      });
      setSubmitted(true);
    } catch (err: any) {
      // error shown inline
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight">RealBench</span>
          <div className="flex items-center gap-4">
            <a href="#waitlist" className="text-sm text-gray-300 hover:text-white transition hidden sm:block">Join Waitlist</a>
            <a
              href="https://github.com/SaschaKohler/realbench"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-white transition"
              aria-label="GitHub"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" /></svg>
            </a>
            <Link
              to="/dashboard"
              className="text-sm px-3 py-1.5 rounded-md border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white transition"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1 rounded-full border border-blue-800 bg-blue-950/50 text-blue-300 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Early Access — Waitlist Open
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight mb-6">
          Performance Profiling<br />
          <span className="text-blue-400">as a Service</span>
        </h1>
        <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          Automatic flamegraph generation, hardware counter analysis, and AI-powered optimization suggestions — triggered from GitHub Actions with a single step. No servers, no agents, no setup.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="#waitlist"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition"
          >
            Join the Waitlist
          </a>
          <a
            href="#how-it-works"
            className="px-6 py-3 border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white font-medium rounded-lg transition"
          >
            See How It Works
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-gray-800 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {howItWorks.map(({ step, title, desc }) => (
              <div key={step} className="relative">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold mb-3">
                  {step}
                </div>
                <h3 className="font-semibold mb-1">{title}</h3>
                <p className="text-sm text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-gray-800 py-20 bg-gray-900/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">What You Get</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon, title, desc }) => (
              <div key={title} className="bg-gray-800/60 border border-gray-700 rounded-xl p-6 hover:border-gray-500 transition">
                <span className="text-2xl mb-3 block">{icon}</span>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="border-t border-gray-800 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">Works With Your Stack</h2>
          <p className="text-center text-gray-400 mb-12 max-w-xl mx-auto">
            RealBench profiles any Linux ELF binary — C++, Rust, Go, or anything that compiles to native code.
          </p>
          <div className="grid lg:grid-cols-3 gap-6">
            {useCases.map(({ lang, color, example, story }) => (
              <div key={lang} className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden hover:border-gray-500 transition">
                <div className={`px-5 py-3 border-b border-gray-700 flex items-center gap-2`}>
                  <span className={`w-2 h-2 rounded-full ${color === 'blue' ? 'bg-blue-400' : color === 'orange' ? 'bg-orange-400' : 'bg-cyan-400'}`} />
                  <span className="font-semibold text-sm">{lang}</span>
                </div>
                <pre className="text-xs text-gray-300 p-4 overflow-x-auto bg-gray-900/60 font-mono leading-relaxed">{example}</pre>
                <div className="px-5 py-4">
                  <p className="text-sm text-gray-400 leading-relaxed">{story}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing note */}
      <section className="border-t border-gray-800 py-16 bg-gray-900/40">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold mb-4">Simple, Transparent Limits</h2>
          <div className="grid sm:grid-cols-2 gap-6 mt-8 text-left">
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-6">
              <div className="text-sm font-medium text-gray-400 mb-1">Free (Beta)</div>
              <div className="text-2xl font-bold mb-4">5 runs / month</div>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex gap-2"><span className="text-green-400">✓</span> Flamegraph visualization</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> Hardware counters</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> AI optimization suggestions</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> GitHub PR comments</li>
                <li className="flex gap-2"><span className="text-yellow-400">~</span> Up to 50 MB binary</li>
              </ul>
            </div>
            <div className="bg-blue-950/40 border border-blue-800 rounded-xl p-6">
              <div className="text-sm font-medium text-blue-300 mb-1">Pro (coming soon)</div>
              <div className="text-2xl font-bold mb-4">Unlimited</div>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex gap-2"><span className="text-green-400">✓</span> Unlimited profiling runs</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> Up to 500 MB binaries</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> Priority queue</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> Run history &amp; diff archive</li>
                <li className="flex gap-2"><span className="text-green-400">✓</span> Email support</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist form */}
      <section id="waitlist" className="border-t border-gray-800 py-20">
        <div className="max-w-lg mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Get Early Access</h2>
          <p className="text-gray-400 mb-8">
            RealBench is in closed beta. Join the waitlist and we'll send you access as soon as a slot opens.
          </p>
          {submitted ? (
            <div className="bg-green-950/50 border border-green-700 rounded-xl p-8">
              <div className="text-3xl mb-3">🎉</div>
              <h3 className="text-lg font-semibold mb-2">You're on the list!</h3>
              <p className="text-sm text-gray-400">We'll email you at <strong>{form.email}</strong> when your access is ready.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@company.com"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Optional"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Primary language</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="">— Select —</option>
                  {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">What will you profile?</label>
                <textarea
                  value={form.useCase}
                  onChange={(e) => setForm({ ...form, useCase: e.target.value })}
                  placeholder="e.g. a game engine, a database, a trading system…"
                  rows={3}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition resize-none"
                />
              </div>
              {join.error && (
                <p className="text-sm text-red-400">{(join.error as Error).message}</p>
              )}
              <button
                type="submit"
                disabled={join.isPending}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
              >
                {join.isPending ? 'Joining…' : 'Join the Waitlist'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-500">
          <span>© {new Date().getFullYear()} RealBench</span>
          <div className="flex gap-6">
            <a href="https://github.com/SaschaKohler/realbench" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 transition">GitHub</a>
            <a href="mailto:hello@realbench.dev" className="hover:text-gray-300 transition">Contact</a>
            <Link to="/dashboard" className="hover:text-gray-300 transition">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
