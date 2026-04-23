import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, real } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  name: text('name').notNull(),
  language: text('language').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const profilingRuns = pgTable('profiling_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  commitSha: text('commit_sha').notNull(),
  branch: text('branch').notNull(),
  buildType: text('build_type').notNull(),
  status: text('status').notNull().default('pending'),
  flamegraphUrl: text('flamegraph_url'),
  hotspots: jsonb('hotspots'),
  suggestions: jsonb('suggestions'),
  regressionDetected: boolean('regression_detected'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
  
  // P0: perf stat mode fields
  profilingMode: text('profiling_mode').default('sampling'), // 'sampling' | 'stat'
  isStatMode: boolean('is_stat_mode').default(false),
  timeElapsedSeconds: real('time_elapsed_seconds'),
  cpuUtilizationPercent: integer('cpu_utilization_percent'),
  
  // P0/P1: Hardware counter results (stored as JSON array)
  counters: jsonb('counters'), // Array of {name, value, unitRatio, unitName, comment}
  
  // P1b: Context switch tracing results
  hasContextSwitchData: boolean('has_context_switch_data').default(false),
  contextSwitchStats: jsonb('context_switch_stats'), // {totalSwitches, voluntarySwitches, involuntarySwitches, migrations, avgSwitchIntervalMs, uniqueThreads, mostActiveThread}
  contextSwitches: jsonb('context_switches'), // Array of context switch events (truncated if too large)

  // GitHub integration
  githubRepo: text('github_repo'), // e.g. "owner/repo"
  githubPrNumber: integer('github_pr_number'),
  githubCommentId: text('github_comment_id'), // ID of the posted PR comment for later edits
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  keyHash: text('key_hash').notNull().unique(), // SHA-256 hex of the raw key
  label: text('label').notNull().default('CI Key'),
  createdAt: timestamp('created_at').defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  apiKeys: many(apiKeys),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  profilingRuns: many(profilingRuns),
}));

export const profilingRunsRelations = relations(profilingRuns, ({ one }) => ({
  project: one(projects, { fields: [profilingRuns.projectId], references: [projects.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ProfilingRun = typeof profilingRuns.$inferSelect;
export type NewProfilingRun = typeof profilingRuns.$inferInsert;
