CREATE TABLE `prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`company` text NOT NULL,
	`domain` text NOT NULL,
	`url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`channel_type` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`telegram` text DEFAULT '' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
