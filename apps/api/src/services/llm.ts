import Anthropic from '@anthropic-ai/sdk';
import { ProfilingRun, LLMAnalysis, LLMAnalysisSchema, Hotspot, DiffEntry } from '@realbench/shared';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are a performance engineering assistant specializing in C++, Rust, and Go profiling.
You receive structured flamegraph data and return actionable optimization suggestions in JSON.

Rules:
- Your entire response MUST be a single valid JSON object. Start with { and end with }.
- Do NOT wrap the output in markdown code fences, backticks, or any prose.
- Rank suggestions by estimated impact (high/medium/low)
- Be concrete: name the exact function, file, and line if available
- Suggest a fix, not just a diagnosis
- Max 5 suggestions per analysis
- If the diff shows a regression, flag it explicitly`;

interface BuildPromptParams {
  projectName: string;
  language: string;
  commitSha: string;
  branch: string;
  buildType: string;
  hotspots: Hotspot[];
  diff?: DiffEntry[];
  constraints?: string;
}

function buildPrompt(params: BuildPromptParams): string {
  const { projectName, language, commitSha, branch, buildType, hotspots, diff, constraints } = params;

  return `
Analyze this profiling run and return optimization suggestions.

## Context
- Project: ${projectName}
- Language: ${language}
- Commit: ${commitSha}
- Branch: ${branch}
- Build type: ${buildType}

## Top hotspots (sorted by % CPU)
${JSON.stringify(hotspots, null, 2)}

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
  constraints?: string
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
