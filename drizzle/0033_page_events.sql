CREATE TABLE `site_events` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`path` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`campaign` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_events_created_idx` ON `site_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `site_events_kind_idx` ON `site_events` (`kind`,`created_at`);
