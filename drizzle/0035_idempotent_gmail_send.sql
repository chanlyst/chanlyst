ALTER TABLE `outbound_messages` ADD `send_started_at` text;
--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `send_uncertain` integer DEFAULT 0 NOT NULL;
