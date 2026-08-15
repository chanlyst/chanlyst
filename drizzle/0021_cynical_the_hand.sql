CREATE TABLE `outreach_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`engagement_mode` text DEFAULT '' NOT NULL,
	`locale` text DEFAULT 'ru' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outreach_templates_workspace_idx` ON `outreach_templates` (`workspace_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `template_id` text DEFAULT '' NOT NULL;