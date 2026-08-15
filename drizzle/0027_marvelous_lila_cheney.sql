CREATE TABLE `lead_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lead_id` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`due_at` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`snoozed_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lead_tasks_workspace_status_idx` ON `lead_tasks` (`workspace_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `lead_tasks_lead_type_idx` ON `lead_tasks` (`lead_id`,`type`);