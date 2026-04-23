ALTER TABLE "profiling_runs" ADD COLUMN "profiling_mode" text DEFAULT 'sampling';
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "is_stat_mode" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "time_elapsed_seconds" integer;
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "cpu_utilization_percent" integer;
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "counters" jsonb;
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "has_context_switch_data" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "context_switch_stats" jsonb;
--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "context_switches" jsonb;
