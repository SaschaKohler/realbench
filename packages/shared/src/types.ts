import { z } from 'zod';

export const LanguageSchema = z.enum(['cpp', 'rust', 'go']);
export type Language = z.infer<typeof LanguageSchema>;

export const BuildTypeSchema = z.enum(['release', 'debug']);
export type BuildType = z.infer<typeof BuildTypeSchema>;

export const RunStatusSchema = z.enum(['pending', 'processing', 'done', 'failed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const PlanSchema = z.enum(['free', 'pro', 'team']);
export type Plan = z.infer<typeof PlanSchema>;

export const HotspotSchema = z.object({
  symbol: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  selfPct: z.number(),
  totalPct: z.number(),
  callCount: z.number(),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

export const DiffEntrySchema = z.object({
  symbol: z.string(),
  baselinePct: z.number(),
  currentPct: z.number(),
  deltaPct: z.number(),
  status: z.enum(['regression', 'improvement', 'stable']),
});
export type DiffEntry = z.infer<typeof DiffEntrySchema>;

export const SuggestionImpactSchema = z.enum(['high', 'medium', 'low']);
export type SuggestionImpact = z.infer<typeof SuggestionImpactSchema>;

export const SuggestionSchema = z.object({
  rank: z.number(),
  impact: SuggestionImpactSchema,
  symbol: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  problem: z.string(),
  fix: z.string(),
  estimatedSpeedup: z.string().nullable(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const LLMAnalysisSchema = z.object({
  regressionDetected: z.boolean(),
  regressionSummary: z.string().nullable(),
  suggestions: z.array(SuggestionSchema),
});
export type LLMAnalysis = z.infer<typeof LLMAnalysisSchema>;

export const HardwareCountersSchema = z.object({
  cycles: z.boolean().optional(),
  instructions: z.boolean().optional(),
  cacheReferences: z.boolean().optional(),
  cacheMisses: z.boolean().optional(),
  branchInstructions: z.boolean().optional(),
  branchMisses: z.boolean().optional(),
  stalledCyclesFrontend: z.boolean().optional(),
  stalledCyclesBackend: z.boolean().optional(),
  contextSwitches: z.boolean().optional(),
  cpuMigrations: z.boolean().optional(),
  pageFaults: z.boolean().optional(),
  // P1: Detailed cache counters
  l1DcacheLoads: z.boolean().optional(),
  l1DcacheLoadMisses: z.boolean().optional(),
  l1DcacheStores: z.boolean().optional(),
  l1DcacheStoreMisses: z.boolean().optional(),
  l1IcacheLoads: z.boolean().optional(),
  l1IcacheLoadMisses: z.boolean().optional(),
  llcLoads: z.boolean().optional(),
  llcLoadMisses: z.boolean().optional(),
  llcStores: z.boolean().optional(),
  llcStoreMisses: z.boolean().optional(),
  // P1: TLB counters
  dtlbLoads: z.boolean().optional(),
  dtlbLoadMisses: z.boolean().optional(),
  dtlbStores: z.boolean().optional(),
  dtlbStoreMisses: z.boolean().optional(),
  itlbLoads: z.boolean().optional(),
  itlbLoadMisses: z.boolean().optional(),
  custom: z.array(z.string()).optional(),
});
export type HardwareCountersConfig = z.infer<typeof HardwareCountersSchema>;

export const ProfilingOptionsSchema = z.object({
  mode: z.enum(['sampling', 'stat']).optional(),
  statDetailed: z.boolean().optional(),
  hwCounters: HardwareCountersSchema.optional(),
  traceContextSwitches: z.boolean().optional(),
  durationSeconds: z.number().min(5).max(300).optional(),
  frequencyHz: z.number().min(1).max(1000).optional(),
  includeKernel: z.boolean().optional(),
});
export type ProfilingOptions = z.infer<typeof ProfilingOptionsSchema>;

export const ProfileRequestSchema = z.object({
  projectId: z.string().uuid(),
  commitSha: z.string().min(7).max(40),
  branch: z.string().min(1),
  buildType: BuildTypeSchema,
  binaryName: z.string().min(1),
  // P0/P1/P1b: Profiling configuration options
  profilingOptions: ProfilingOptionsSchema.optional(),
});
export type ProfileRequest = z.infer<typeof ProfileRequestSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  language: LanguageSchema,
});
export type CreateProjectRequest = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectSchema>;
