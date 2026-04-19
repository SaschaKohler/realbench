import { pgTable, uuid, text, timestamp, jsonb, boolean, integer } from 'drizzle-orm/pg-core';
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
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
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
