import Anthropic from '@anthropic-ai/sdk';
import { ProfilingRun, LLMAnalysis, LLMAnalysisSchema, Hotspot, DiffEntry, SuggestionImpact } from '@realbench/shared';
import { SourceSnippet, isTestFile } from './source-extractor.js';

function normalizeImpact(raw: string): SuggestionImpact {
  const v = (raw ?? '').toLowerCase().trim();
  if (v === 'critical' || v === 'high') return 'high';
  if (v === 'medium' || v === 'moderate' || v === 'med') return 'medium';
  return 'low';
}

interface CounterResult {
  name: string;
  value: number;
  unitRatio: number;
  unitName: string;
  comment: string;
}

interface ContextSwitchStats {
  totalSwitches: number;
  voluntarySwitches: number;
  involuntarySwitches: number;
  migrations: number;
  avgSwitchIntervalMs: number;
  uniqueThreads: number;
  mostActiveThread: number;
}

interface StatRunInput {
  projectName: string;
  language: string;
  commitSha: string;
  branch: string;
  buildType: string;
  timeElapsedSeconds?: number | null;
  cpuUtilizationPercent?: number | null;
  counters?: CounterResult[] | null;
  contextSwitchStats?: ContextSwitchStats | null;
}

export type { StatRunInput };

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are a performance engineering assistant specializing in C++, Rust, and Go profiling.
You receive structured flamegraph data with optional source code context and return actionable optimization suggestions in JSON.

CRITICAL RULES:
1. Your entire response MUST be a single valid JSON object. Start with { and end with }.
2. Do NOT wrap the output in markdown code fences, backticks, or any prose.
3. Only suggest fixes for CLEAR anti-patterns. When in doubt, omit the suggestion.
4. For test/benchmark files (file path contains "test", "spec", "bench"): Only flag issues if they're clearly unintentional performance bugs.
5. Sequential memory access patterns are NORMAL for memory-bound workloads - do NOT flag as problematic.
6. Debug build overhead (memset from debug allocators, additional checks) should NOT be flagged as optimization targets.
7. Be concrete: name the exact function, file, and line when source context is available.
8. Provide realistic speedup estimates only when you understand the bottleneck category.
9. Max 5 suggestions per analysis.
10. If the diff shows a regression, flag it explicitly.

SYMBOL CLASSIFICATION — apply before analyzing:
- SLEEP/WAIT symbols (NOT CPU work): __lll_lock_wait, __lll_lock_wait_private, __futex_abstimed_wait_cancelable64, __clock_nanosleep, __pthread_clockjoin_ex, __lll_lock_wake, __lll_lock_wake_private, sem_wait, pthread_cond_wait, epoll_wait, poll, select, nanosleep. These represent BLOCKING time, not CPU cycles. High % means threads are waiting, not computing.
- SYNCHRONIZATION overhead symbols: std::mutex::lock, std::unique_lock::lock, std::condition_variable::wait. High % = lock contention design problem.
- ACTUAL CPU WORK: user functions, math operations (sin, cos, sqrt, log), memory operations (memset, memcpy), allocator calls (malloc, new).

For multithreaded profiles:
- If sleep/wait symbols dominate (>20% combined): classify as LOCK CONTENTION or SYNCHRONIZATION bottleneck, not a CPU hotspot.
- Recommend: reduce critical section size, use lock-free data structures, rethink synchronization strategy.
- Report what fraction of wall time is WASTED in synchronization vs. useful work.
- If source context is available, point to the exact mutex/lock lines.`;

interface BuildPromptParams {
  projectName: string;
  language: string;
  commitSha: string;
  branch: string;
  buildType: string;
  hotspots: Hotspot[];
  diff?: DiffEntry[];
  constraints?: string;
  sourceSnippets?: SourceSnippet[];
}

function buildPrompt(params: BuildPromptParams): string {
  const { projectName, language, commitSha, branch, buildType, hotspots, diff, constraints, sourceSnippets } = params;

  // Build hotspots with source context
  const hotspotsWithContext = hotspots.map((h, i) => {
    const snippet = sourceSnippets?.find(s => s.symbol === h.symbol && s.file === h.file);
    const testFileIndicator = (h.file && isTestFile(h.file)) ? ' [TEST FILE]' : '';

    return {
      rank: i + 1,
      symbol: h.symbol,
      file: h.file || 'unknown',
      line: h.line || 0,
      selfPercentage: h.selfPct,
      totalPercentage: h.totalPct,
      callCount: h.callCount,
      isTestFile: !!testFileIndicator,
      sourceContext: snippet ? snippet.context : null,
    };
  });

  const SLEEP_WAIT = new Set([
    '__lll_lock_wait', '__lll_lock_wait_private', '__futex_abstimed_wait_cancelable64',
    '__clock_nanosleep', '__pthread_clockjoin_ex', '__lll_lock_wake', '__lll_lock_wake_private',
    'sem_wait', 'pthread_cond_wait', 'epoll_wait', 'nanosleep', 'poll', 'select',
  ]);
  const SYNC = new Set([
    'std::mutex::lock()', '__pthread_mutex_lock',
    'std::unique_lock<std::mutex>::lock()', 'std::unique_lock<std::mutex>::unique_lock(std::mutex&)',
    'std::condition_variable::wait',
  ]);
  const classifySym = (sym: string) => {
    const base = sym.split(' ')[0].split('@')[0].trim();
    if (SLEEP_WAIT.has(base)) return 'sleep';
    if (SYNC.has(base) || base.startsWith('std::mutex') || base.startsWith('std::unique_lock') || base.startsWith('std::condition_variable')) return 'sync';
    return 'cpu';
  };
  const sleepPct = hotspots.reduce((s, h) => classifySym(h.symbol) === 'sleep' ? s + h.selfPct : s, 0);
  const syncPct = hotspots.reduce((s, h) => classifySym(h.symbol) === 'sync' ? s + h.selfPct : s, 0);
  const cpuPct = hotspots.reduce((s, h) => classifySym(h.symbol) === 'cpu' ? s + h.selfPct : s, 0);

  return `
Analyze this profiling run and return optimization suggestions.

## Context
- Project: ${projectName}
- Language: ${language}
- Commit: ${commitSha}
- Branch: ${branch}
- Build type: ${buildType}
- Source snippets available: ${sourceSnippets?.length || 0}

## Thread Time Budget (pre-classified)
- CPU work (user code + math + memory ops): ${cpuPct.toFixed(1)}%
- Blocking/wait (sleep, futex, nanosleep — threads NOT using CPU): ${sleepPct.toFixed(1)}%
- Synchronization overhead (mutex acquire, condvar): ${syncPct.toFixed(1)}%
${sleepPct > 20 ? `⚠ PRIMARY BOTTLENECK IS SYNCHRONIZATION: ${sleepPct.toFixed(1)}% of samples are sleeping/waiting threads. Analyze the lock contention root cause.` : ''}

## Hotspots with Source Context (sorted by % CPU)
${JSON.stringify(hotspotsWithContext, null, 2)}

${diff ? `## Flamegraph diff vs. baseline\n${JSON.stringify(diff, null, 2)}` : ''}

${constraints ? `## Constraints\n${constraints}` : ''}

Respond with a JSON object matching this structure exactly:
{
  "regression_detected": false,
  "regression_summary": null,
  "suggestions": [
    {
      "rank": 1,
      "impact": "high",
      "symbol": "MyClass::expensiveMethod",
      "file": "src/myclass.cpp",
      "line": 42,
      "problem": "Description of the bottleneck",
      "fix": "Concrete fix to apply",
      "estimated_speedup": "~20%"
    }
  ]
}
`.trim();
}

export async function analyzeProfiling(
  run: ProfilingRun & { projectName: string; language: string },
  baseline?: ProfilingRun,
  constraints?: string,
  sourceSnippets?: SourceSnippet[]
): Promise<LLMAnalysis> {
  const hotspots = (run.hotspots as Hotspot[]) || [];
  const diff = baseline ? (baseline.hotspots as DiffEntry[]) : undefined;

  const prompt = buildPrompt({
    projectName: run.projectName,
    language: run.language,
    commitSha: run.commitSha,
    branch: run.branch,
    buildType: run.buildType,
    hotspots,
    diff,
    constraints,
    sourceSnippets,
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
  console.log('LLM raw response:', rawText.substring(0, 500));
  const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const parsed = JSON.parse(text);
  console.log('LLM parsed suggestions count:', parsed.suggestions?.length ?? 0);
  const analysis = LLMAnalysisSchema.parse({
    regressionDetected: parsed.regression_detected,
    regressionSummary: parsed.regression_summary,
    suggestions: parsed.suggestions.map((s: any) => ({
      rank: s.rank,
      impact: normalizeImpact(s.impact),
      symbol: s.symbol,
      file: s.file,
      line: s.line,
      problem: s.problem,
      fix: s.fix,
      estimatedSpeedup: s.estimated_speedup,
    })),
  });

  return analysis;
}

const STAT_SYSTEM_PROMPT = `You are a performance engineering assistant specializing in hardware performance counter analysis for C++, Rust, and Go.
You receive perf stat output (hardware counters, CPU utilization, timing) and return actionable optimization suggestions in JSON.

CRITICAL RULES:
1. Your entire response MUST be a single valid JSON object. Start with { and end with }.
2. Do NOT wrap the output in markdown code fences, backticks, or any prose.
3. Derive bottleneck category from counter ratios: IPC < 1.0 = memory/branch-bound; IPC 1.0-2.5 = moderate utilization; IPC > 3.0 = likely compute-bound.
4. COUNTER HIERARCHY — understand what each counter measures:
   - cache-references / cache-misses: LLC (L3) cache level, not L1. These are requests that REACH the L3. Miss rate = cache-misses/cache-references.
   - L1-dcache-loads / L1-dcache-load-misses: L1 data cache. Only flag L1 miss rate if > 5%.
   - LLC-loads / LLC-load-misses: Last Level Cache (L3) load specifically. If LLC-loads = 0 but cache-misses > 0, the misses are being absorbed by hardware prefetcher or are L3 hits from cache-references events.
   - If L1-dcache-load-misses = 0 AND LLC-load-misses = 0 but cache-misses > 0: memory access pattern is actually GOOD — prefetcher is working. Do NOT flag as poor memory locality.
5. Branch miss rate = branch_misses / branch_instructions. > 2% warrants investigation.
6. Frontend stall fraction = stalled_cycles_frontend / cycles. > 20% = fetch/decode bottleneck.
7. Backend stall fraction = stalled_cycles_backend / cycles. > 30% = execution unit or memory bottleneck.
8. For multithreaded programs: IPC measured by perf stat reflects ACTIVE thread time. If the program has significant lock wait time (detectable from low CPU utilization or context switches), IPC may look artificially high.
9. Only flag issues with CLEAR counter evidence. Do NOT invent problems that contradict the counter data. Max 5 suggestions.
10. estimatedSpeedup may be null if insufficient evidence.
11. symbol/file/line may be null — stat mode has no per-function breakdown.
12. Be explicit about what the counters ACTUALLY show vs. what you are inferring.`;

function buildStatPrompt(input: StatRunInput): string {
  const { projectName, language, commitSha, branch, buildType,
    timeElapsedSeconds, cpuUtilizationPercent, counters, contextSwitchStats } = input;

  const counterRows = (counters ?? []).map(c => ({
    name: c.name,
    value: c.value,
    unit: c.unitName,
    comment: c.comment,
  }));

  const derivedMetrics: Record<string, string> = {};
  const byName = Object.fromEntries((counters ?? []).map(c => [c.name, c.value]));

  if (byName['instructions'] && byName['cycles']) {
    derivedMetrics['ipc'] = (byName['instructions'] / byName['cycles']).toFixed(3);
  }
  if (byName['cache-misses'] && byName['cache-references'] && byName['cache-references'] > 0) {
    derivedMetrics['cache_miss_rate_pct'] = ((byName['cache-misses'] / byName['cache-references']) * 100).toFixed(2);
  }
  if (byName['branch-misses'] && byName['branch-instructions'] && byName['branch-instructions'] > 0) {
    derivedMetrics['branch_miss_rate_pct'] = ((byName['branch-misses'] / byName['branch-instructions']) * 100).toFixed(2);
  }
  if (byName['stalled-cycles-frontend'] && byName['cycles'] && byName['cycles'] > 0) {
    derivedMetrics['frontend_stall_pct'] = ((byName['stalled-cycles-frontend'] / byName['cycles']) * 100).toFixed(2);
  }
  if (byName['stalled-cycles-backend'] && byName['cycles'] && byName['cycles'] > 0) {
    derivedMetrics['backend_stall_pct'] = ((byName['stalled-cycles-backend'] / byName['cycles']) * 100).toFixed(2);
  }

  return `
Analyze this perf stat run and return optimization suggestions based on hardware counters.

## Context
- Project: ${projectName}
- Language: ${language}
- Commit: ${commitSha}
- Branch: ${branch}
- Build type: ${buildType}
- Wall time: ${timeElapsedSeconds != null ? `${timeElapsedSeconds}s` : 'unknown'}
- CPU utilization: ${cpuUtilizationPercent != null ? `${cpuUtilizationPercent}%` : 'unknown'}

## Hardware Counters
${JSON.stringify(counterRows, null, 2)}

## Derived Metrics
${JSON.stringify(derivedMetrics, null, 2)}

${contextSwitchStats ? `## Context Switch Statistics\n${JSON.stringify(contextSwitchStats, null, 2)}` : ''}

Respond with a JSON object matching this structure exactly:
{
  "regression_detected": false,
  "regression_summary": null,
  "suggestions": [
    {
      "rank": 1,
      "impact": "high",
      "symbol": null,
      "file": null,
      "line": null,
      "problem": "Description of the bottleneck based on counter evidence",
      "fix": "Concrete optimization to apply",
      "estimated_speedup": "~15%"
    }
  ]
}
`.trim();
}

export async function analyzeStatRun(input: StatRunInput): Promise<LLMAnalysis> {
  const prompt = buildStatPrompt(input);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: STAT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
  console.log('LLM stat raw response:', rawText.substring(0, 500));
  const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const parsed = JSON.parse(text);
  console.log('LLM stat suggestions count:', parsed.suggestions?.length ?? 0);
  const analysis = LLMAnalysisSchema.parse({
    regressionDetected: parsed.regression_detected,
    regressionSummary: parsed.regression_summary,
    suggestions: (parsed.suggestions ?? []).map((s: any) => ({
      rank: s.rank,
      impact: normalizeImpact(s.impact),
      symbol: s.symbol ?? null,
      file: s.file ?? null,
      line: s.line ?? null,
      problem: s.problem,
      fix: s.fix,
      estimatedSpeedup: s.estimated_speedup ?? null,
    })),
  });

  return analysis;
}
