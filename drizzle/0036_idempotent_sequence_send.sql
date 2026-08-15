ALTER TABLE `outreach_sequences` ADD `send_started_at` text;
--> statement-breakpoint
ALTER TABLE `outreach_sequences` ADD `send_uncertain` integer DEFAULT 0 NOT NULL;
