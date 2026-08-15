ALTER TABLE `outbound_messages` ADD `gmail_thread_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `replied_at` text;--> statement-breakpoint
ALTER TABLE `outreach_sequences` ADD `replied_at` text;