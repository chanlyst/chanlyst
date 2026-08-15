CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`step` text DEFAULT 'analyze' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_workspace_status_idx` ON `pipeline_runs` (`workspace_id`,`status`);