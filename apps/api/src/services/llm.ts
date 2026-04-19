import Anthropic from '@anthropic-ai/sdk';
import { ProfilingRun, LLMAnalysis, LLMAnalysisSchema, Hotspot, DiffEntry } from '@realbench/shared';
import { SourceSnippet, isTestFile } from './source-extractor.js';

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
7. Be concrete: name the exact function, file, and line.
8. Provide realistic speedup estimates only when you understand the bottleneck category.
9. Max 5 suggestions per analysis.
10. If the diff shows a regression, flag it explicitly.`;

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

  return `
Analyze this profiling run and return optimization suggestions.

## Context
- Project: ${projectName}
- Language: ${language}
- Commit: ${commitSha}
- Branch: ${branch}
- Build type: ${buildType}
- Source snippets available: ${sourceSnippets?.length || 0}

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
      impact: s.impact,
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
