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
CREATE INDEX IF NOT EXISTS `agent_runs_workspace_started_idx` ON `agent_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
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
CREATE INDEX IF NOT EXISTS `agent_schedules_due_idx` ON `agent_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `billing_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outreach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`step_number` integer DEFAULT 0 NOT NULL,
	`event_type` text NOT NULL,
	`gmail_message_id` text DEFAULT '' NOT NULL,
	`gmail_thread_id` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `outreach_events_sequence_idx` ON `outreach_events` (`sequence_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `outreach_events_workspace_type_idx` ON `outreach_events` (`workspace_id`,`event_type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outreach_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`name` text NOT NULL,
	`recipient_email` text NOT NULL,
	`recipient_name` text DEFAULT '' NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`next_step` integer DEFAULT 0 NOT NULL,
	`next_run_at` text,
	`daily_limit` integer DEFAULT 20 NOT NULL,
	`last_sent_at` text,
	`stopped_reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `outreach_sequences_due_idx` ON `outreach_sequences` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `outreach_sequences_workspace_idx` ON `outreach_sequences` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `suppression_list` (
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `email`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_usage_workspace_created_idx` ON `ai_usage` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_workspace_idx` ON `outbound_messages` (`workspace_id`,`product_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `products_workspace_idx` ON `products` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `prospects_workspace_idx` ON `prospects` (`workspace_id`,`product_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `prospects_workspace_created_idx` ON `prospects` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_user_idx` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_idx` ON `users` (`email`) WHERE "users"."email" <> '';