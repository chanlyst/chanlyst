CREATE TABLE `digest_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`locale` text DEFAULT 'ru' NOT NULL,
	`last_sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
