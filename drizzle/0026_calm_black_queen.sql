ALTER TABLE `ai_usage` ADD `outcome` text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `status_code` integer DEFAULT 0 NOT NULL;