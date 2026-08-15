CREATE TABLE `site_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`medium` text DEFAULT '' NOT NULL,
	`campaign` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`referrer_host` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `site_visits_created_idx` ON `site_visits` (`created_at`);--> statement-breakpoint
CREATE INDEX `site_visits_source_idx` ON `site_visits` (`source`,`created_at`);
