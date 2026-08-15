CREATE TABLE `channel_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`url` text NOT NULL,
	`status_code` integer DEFAULT 0 NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`mentions_product` integer DEFAULT 0 NOT NULL,
	`price_excerpt` text DEFAULT '' NOT NULL,
	`checked_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_snapshots_lead_idx` ON `channel_snapshots` (`lead_id`,`checked_at`);