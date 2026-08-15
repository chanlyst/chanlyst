ALTER TABLE `products` ADD `monitoring_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `monitoring_sources` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `monitoring_last_seen_at` text;