ALTER TABLE "profiling_runs" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "github_pr_number" integer;--> statement-breakpoint
ALTER TABLE "profiling_runs" ADD COLUMN "github_comment_id" text;