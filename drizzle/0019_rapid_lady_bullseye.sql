ALTER TABLE `prospects` ADD `placement_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `placement_submitted_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `placement_checked_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `placement_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `utm_link` text DEFAULT '' NOT NULL;