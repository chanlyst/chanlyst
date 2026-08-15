ALTER TABLE `prospects` ADD `contact_role` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `linkedin` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `contact_status` text DEFAULT 'not_checked' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `contact_source_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `contact_evidence` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `contact_confidence` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `contact_checked_at` text;
