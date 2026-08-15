CREATE TABLE IF NOT EXISTS `agent_schedules` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `enabled` integer DEFAULT 0 NOT NULL,
  `cadence` text DEFAULT 'weekly' NOT NULL,
  `max_results` integer DEFAULT 12 NOT NULL,
  `sources` text DEFAULT '["web","reviews","creators","communities"]' NOT NULL,
  `next_run_at` text,
  `last_run_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `products_processed` integer DEFAULT 0 NOT NULL,
  `opportunities_found` integer DEFAULT 0 NOT NULL,
  `error` text DEFAULT '' NOT NULL,
  `started_at` text NOT NULL,
  `finished_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_schedules_due_idx`
ON `agent_schedules` (`enabled`, `next_run_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_runs_workspace_started_idx`
ON `agent_runs` (`workspace_id`, `started_at`);
