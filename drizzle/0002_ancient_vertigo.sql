CREATE TABLE `integrations` (
	`provider` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`account_label` text DEFAULT '' NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`refresh_token` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`negative_audience` text DEFAULT '' NOT NULL,
	`geography` text DEFAULT '' NOT NULL,
	`languages` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT 'paid_customers' NOT NULL,
	`analysis` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `product_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `error` text;