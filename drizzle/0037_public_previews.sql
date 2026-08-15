CREATE TABLE `public_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`ip_hash` text NOT NULL,
	`input_hash` text NOT NULL,
	`website` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`analysis_json` text DEFAULT '{}' NOT NULL,
	`results_json` text DEFAULT '[]' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`product_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`claimed_at` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_previews_token_hash_unique` ON `public_previews` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `public_previews_ip_created_idx` ON `public_previews` (`ip_hash`,`created_at`);
--> statement-breakpoint
CREATE INDEX `public_previews_expires_idx` ON `public_previews` (`expires_at`);
