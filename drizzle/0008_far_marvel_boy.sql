CREATE TABLE `auth_attempts` (
	`identity_hash` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`provider`, `provider_account_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`verifier` text DEFAULT '' NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_integrations` (
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`account_label` text DEFAULT '' NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`refresh_token` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `workspace_id` text DEFAULT 'workspace-owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `workspace_id` text DEFAULT 'workspace-owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbound_messages` ADD `workspace_id` text DEFAULT 'workspace-owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `workspace_id` text DEFAULT 'workspace-owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `workspace_id` text DEFAULT 'workspace-owner' NOT NULL;--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`, `expires_at`);--> statement-breakpoint
CREATE INDEX `products_workspace_idx` ON `products` (`workspace_id`, `updated_at`);--> statement-breakpoint
CREATE INDEX `prospects_workspace_idx` ON `prospects` (`workspace_id`, `product_id`);--> statement-breakpoint
CREATE INDEX `messages_workspace_idx` ON `outbound_messages` (`workspace_id`, `product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`) WHERE `email` <> '';--> statement-breakpoint
INSERT OR IGNORE INTO `users`
(`id`, `email`, `name`, `avatar_url`, `created_at`, `updated_at`)
VALUES
('owner', '', 'Owner', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `workspaces`
(`id`, `name`, `owner_user_id`, `created_at`, `updated_at`)
VALUES
('workspace-owner', 'Chanlyst', 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `workspace_members`
(`workspace_id`, `user_id`, `role`, `created_at`)
VALUES
('workspace-owner', 'owner', 'owner', CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `workspace_integrations`
(`workspace_id`, `provider`, `status`, `account_label`, `access_token`,
 `refresh_token`, `expires_at`, `metadata`, `updated_at`)
SELECT 'workspace-owner', `provider`, `status`, `account_label`, `access_token`,
 `refresh_token`, `expires_at`, `metadata`, `updated_at`
FROM `integrations`;
