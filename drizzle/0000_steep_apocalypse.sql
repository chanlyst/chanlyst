CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text NOT NULL,
	`target` text NOT NULL,
	`negative` text NOT NULL,
	`sources` text NOT NULL,
	`leads` text NOT NULL,
	`lead_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
