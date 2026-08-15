PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`products_processed` integer DEFAULT 0 NOT NULL,
	`opportunities_found` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_runs`("id", "workspace_id", "status", "products_processed", "opportunities_found", "error", "started_at", "finished_at") SELECT "id", "workspace_id", "status", "products_processed", "opportunities_found", "error", "started_at", "finished_at" FROM `agent_runs`;--> statement-breakpoint
DROP TABLE `agent_runs`;--> statement-breakpoint
ALTER TABLE `__new_agent_runs` RENAME TO `agent_runs`;--> statement-breakpoint
CREATE INDEX `agent_runs_workspace_started_idx` ON `agent_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `__new_agent_schedules` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`max_results` integer DEFAULT 12 NOT NULL,
	`sources` text DEFAULT '["web","reviews","creators","communities"]' NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_schedules`("workspace_id", "enabled", "cadence", "max_results", "sources", "next_run_at", "last_run_at", "created_at", "updated_at") SELECT "workspace_id", "enabled", "cadence", "max_results", "sources", "next_run_at", "last_run_at", "created_at", "updated_at" FROM `agent_schedules`;--> statement-breakpoint
DROP TABLE `agent_schedules`;--> statement-breakpoint
ALTER TABLE `__new_agent_schedules` RENAME TO `agent_schedules`;--> statement-breakpoint
CREATE INDEX `agent_schedules_due_idx` ON `agent_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `__new_ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text DEFAULT '' NOT NULL,
	`operation` text NOT NULL,
	`provider` text DEFAULT 'openrouter' NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`web_search_requests` integer DEFAULT 0 NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`workspace_id` text DEFAULT 'workspace-owner' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage`("id", "product_id", "operation", "provider", "model", "input_tokens", "output_tokens", "reasoning_tokens", "web_search_requests", "cost_microusd", "created_at", "workspace_id") SELECT "id", "product_id", "operation", "provider", "model", "input_tokens", "output_tokens", "reasoning_tokens", "web_search_requests", "cost_microusd", "created_at", "workspace_id" FROM `ai_usage`;--> statement-breakpoint
DROP TABLE `ai_usage`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage` RENAME TO `ai_usage`;--> statement-breakpoint
CREATE INDEX `ai_usage_workspace_created_idx` ON `ai_usage` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text NOT NULL,
	`target` text NOT NULL,
	`negative` text NOT NULL,
	`sources` text NOT NULL,
	`leads` text NOT NULL,
	`lead_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`workspace_id` text DEFAULT 'workspace-owner' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_campaigns`("id", "name", "website", "target", "negative", "sources", "leads", "lead_count", "created_at", "updated_at", "workspace_id") SELECT "id", "name", "website", "target", "negative", "sources", "leads", "lead_count", "created_at", "updated_at", "workspace_id" FROM `campaigns`;--> statement-breakpoint
DROP TABLE `campaigns`;--> statement-breakpoint
ALTER TABLE `__new_campaigns` RENAME TO `campaigns`;--> statement-breakpoint
CREATE TABLE `__new_digest_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`locale` text DEFAULT 'ru' NOT NULL,
	`last_sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_digest_settings`("workspace_id", "enabled", "cadence", "locale", "last_sent_at", "created_at", "updated_at") SELECT "workspace_id", "enabled", "cadence", "locale", "last_sent_at", "created_at", "updated_at" FROM `digest_settings`;--> statement-breakpoint
DROP TABLE `digest_settings`;--> statement-breakpoint
ALTER TABLE `__new_digest_settings` RENAME TO `digest_settings`;--> statement-breakpoint
CREATE TABLE `__new_oauth_accounts` (
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`provider`, `provider_account_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_accounts`("provider", "provider_account_id", "user_id", "email", "created_at", "updated_at") SELECT "provider", "provider_account_id", "user_id", "email", "created_at", "updated_at" FROM `oauth_accounts`;--> statement-breakpoint
DROP TABLE `oauth_accounts`;--> statement-breakpoint
ALTER TABLE `__new_oauth_accounts` RENAME TO `oauth_accounts`;--> statement-breakpoint
CREATE TABLE `__new_outbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text DEFAULT '' NOT NULL,
	`lead_id` text NOT NULL,
	`company` text NOT NULL,
	`channel` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`sent_at` text,
	`gmail_thread_id` text DEFAULT '' NOT NULL,
	`replied_at` text,
	`error` text,
	`created_at` text NOT NULL,
	`workspace_id` text DEFAULT 'workspace-owner' NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_outbound_messages`("id", "product_id", "lead_id", "company", "channel", "subject", "body", "status", "sent_at", "gmail_thread_id", "replied_at", "error", "created_at", "workspace_id") SELECT "id", "product_id", "lead_id", "company", "channel", "subject", "body", "status", "sent_at", "gmail_thread_id", "replied_at", "error", "created_at", "workspace_id" FROM `outbound_messages`;--> statement-breakpoint
DROP TABLE `outbound_messages`;--> statement-breakpoint
ALTER TABLE `__new_outbound_messages` RENAME TO `outbound_messages`;--> statement-breakpoint
CREATE INDEX `messages_workspace_idx` ON `outbound_messages` (`workspace_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `__new_outreach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`step_number` integer DEFAULT 0 NOT NULL,
	`event_type` text NOT NULL,
	`gmail_message_id` text DEFAULT '' NOT NULL,
	`gmail_thread_id` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_outreach_events`("id", "workspace_id", "sequence_id", "lead_id", "step_number", "event_type", "gmail_message_id", "gmail_thread_id", "error", "metadata", "occurred_at") SELECT "id", "workspace_id", "sequence_id", "lead_id", "step_number", "event_type", "gmail_message_id", "gmail_thread_id", "error", "metadata", "occurred_at" FROM `outreach_events`;--> statement-breakpoint
DROP TABLE `outreach_events`;--> statement-breakpoint
ALTER TABLE `__new_outreach_events` RENAME TO `outreach_events`;--> statement-breakpoint
CREATE INDEX `outreach_events_sequence_idx` ON `outreach_events` (`sequence_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `outreach_events_workspace_type_idx` ON `outreach_events` (`workspace_id`,`event_type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_outreach_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`name` text NOT NULL,
	`recipient_email` text NOT NULL,
	`recipient_name` text DEFAULT '' NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`next_step` integer DEFAULT 0 NOT NULL,
	`next_run_at` text,
	`daily_limit` integer DEFAULT 20 NOT NULL,
	`last_sent_at` text,
	`stopped_reason` text DEFAULT '' NOT NULL,
	`replied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_outreach_sequences`("id", "workspace_id", "product_id", "lead_id", "name", "recipient_email", "recipient_name", "company", "steps", "status", "next_step", "next_run_at", "daily_limit", "last_sent_at", "stopped_reason", "replied_at", "created_at", "updated_at") SELECT "id", "workspace_id", "product_id", "lead_id", "name", "recipient_email", "recipient_name", "company", "steps", "status", "next_step", "next_run_at", "daily_limit", "last_sent_at", "stopped_reason", "replied_at", "created_at", "updated_at" FROM `outreach_sequences`;--> statement-breakpoint
DROP TABLE `outreach_sequences`;--> statement-breakpoint
ALTER TABLE `__new_outreach_sequences` RENAME TO `outreach_sequences`;--> statement-breakpoint
CREATE INDEX `outreach_sequences_due_idx` ON `outreach_sequences` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `outreach_sequences_workspace_idx` ON `outreach_sequences` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_products` (
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
	`monetization_model` text DEFAULT '' NOT NULL,
	`paid_offer` text DEFAULT '' NOT NULL,
	`price_range` text DEFAULT '' NOT NULL,
	`payment_point` text DEFAULT '' NOT NULL,
	`conversion_event` text DEFAULT '' NOT NULL,
	`attribution_method` text DEFAULT '' NOT NULL,
	`partner_terms` text DEFAULT '' NOT NULL,
	`analysis` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`workspace_id` text DEFAULT 'workspace-owner' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "name", "website", "description", "category", "audience", "negative_audience", "geography", "languages", "goal", "monetization_model", "paid_offer", "price_range", "payment_point", "conversion_event", "attribution_method", "partner_terms", "analysis", "created_at", "updated_at", "workspace_id") SELECT "id", "name", "website", "description", "category", "audience", "negative_audience", "geography", "languages", "goal", "monetization_model", "paid_offer", "price_range", "payment_point", "conversion_event", "attribution_method", "partner_terms", "analysis", "created_at", "updated_at", "workspace_id" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE INDEX `products_workspace_idx` ON `products` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_prospects` (
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
	`stage` text DEFAULT 'discovered' NOT NULL,
	`contacted_at` text,
	`replied_at` text,
	`meeting_at` text,
	`converted_at` text,
	`revenue_cents` integer DEFAULT 0 NOT NULL,
	`outcome_note` text DEFAULT '' NOT NULL,
	`opportunity_type` text DEFAULT 'partner' NOT NULL,
	`action_type` text DEFAULT 'propose_partnership' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`action_url` text DEFAULT '' NOT NULL,
	`engagement_mode` text DEFAULT 'unknown' NOT NULL,
	`commercial_model` text DEFAULT 'unknown' NOT NULL,
	`pricing_summary` text DEFAULT '' NOT NULL,
	`placement_requirements` text DEFAULT '' NOT NULL,
	`usage_terms` text DEFAULT '' NOT NULL,
	`registration_url` text DEFAULT '' NOT NULL,
	`placement_status` text DEFAULT '' NOT NULL,
	`placement_submitted_at` text,
	`placement_checked_at` text,
	`placement_url` text DEFAULT '' NOT NULL,
	`utm_link` text DEFAULT '' NOT NULL,
	`outreach_eligible` integer DEFAULT false NOT NULL,
	`origin` text DEFAULT 'discovered' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`workspace_id` text DEFAULT 'workspace-owner' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_prospects`("id", "product_id", "company", "domain", "url", "description", "source", "channel_type", "reason", "contact", "email", "telegram", "score", "status", "stage", "contacted_at", "replied_at", "meeting_at", "converted_at", "revenue_cents", "outcome_note", "opportunity_type", "action_type", "next_action", "action_url", "engagement_mode", "commercial_model", "pricing_summary", "placement_requirements", "usage_terms", "registration_url", "placement_status", "placement_submitted_at", "placement_checked_at", "placement_url", "utm_link", "outreach_eligible", "origin", "created_at", "updated_at", "workspace_id") SELECT "id", "product_id", "company", "domain", "url", "description", "source", "channel_type", "reason", "contact", "email", "telegram", "score", "status", "stage", "contacted_at", "replied_at", "meeting_at", "converted_at", "revenue_cents", "outcome_note", "opportunity_type", "action_type", "next_action", "action_url", "engagement_mode", "commercial_model", "pricing_summary", "placement_requirements", "usage_terms", "registration_url", "placement_status", "placement_submitted_at", "placement_checked_at", "placement_url", "utm_link", "outreach_eligible", "origin", "created_at", "updated_at", "workspace_id" FROM `prospects`;--> statement-breakpoint
DROP TABLE `prospects`;--> statement-breakpoint
ALTER TABLE `__new_prospects` RENAME TO `prospects`;--> statement-breakpoint
CREATE INDEX `prospects_workspace_idx` ON `prospects` (`workspace_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `prospects_workspace_created_idx` ON `prospects` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("token_hash", "user_id", "workspace_id", "expires_at", "created_at", "last_seen_at") SELECT "token_hash", "user_id", "workspace_id", "expires_at", "created_at", "last_seen_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_subscriptions` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'lemon_squeezy' NOT NULL,
	`customer_id` text DEFAULT '' NOT NULL,
	`subscription_id` text DEFAULT '' NOT NULL,
	`order_id` text DEFAULT '' NOT NULL,
	`product_id` text DEFAULT '' NOT NULL,
	`variant_id` text DEFAULT '' NOT NULL,
	`variant_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`plan` text DEFAULT 'pro' NOT NULL,
	`renews_at` text,
	`ends_at` text,
	`trial_ends_at` text,
	`card_brand` text DEFAULT '' NOT NULL,
	`card_last_four` text DEFAULT '' NOT NULL,
	`portal_url` text DEFAULT '' NOT NULL,
	`update_payment_url` text DEFAULT '' NOT NULL,
	`test_mode` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_subscriptions`("workspace_id", "provider", "customer_id", "subscription_id", "order_id", "product_id", "variant_id", "variant_name", "status", "plan", "renews_at", "ends_at", "trial_ends_at", "card_brand", "card_last_four", "portal_url", "update_payment_url", "test_mode", "created_at", "updated_at") SELECT "workspace_id", "provider", "customer_id", "subscription_id", "order_id", "product_id", "variant_id", "variant_name", "status", "plan", "renews_at", "ends_at", "trial_ends_at", "card_brand", "card_last_four", "portal_url", "update_payment_url", "test_mode", "created_at", "updated_at" FROM `subscriptions`;--> statement-breakpoint
DROP TABLE `subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_subscriptions` RENAME TO `subscriptions`;--> statement-breakpoint
CREATE TABLE `__new_suppression_list` (
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `email`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_suppression_list`("workspace_id", "email", "reason", "created_at") SELECT "workspace_id", "email", "reason", "created_at" FROM `suppression_list`;--> statement-breakpoint
DROP TABLE `suppression_list`;--> statement-breakpoint
ALTER TABLE `__new_suppression_list` RENAME TO `suppression_list`;--> statement-breakpoint
CREATE TABLE `__new_workspace_integrations` (
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`account_label` text DEFAULT '' NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`refresh_token` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `provider`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_workspace_integrations`("workspace_id", "provider", "status", "account_label", "access_token", "refresh_token", "expires_at", "metadata", "updated_at") SELECT "workspace_id", "provider", "status", "account_label", "access_token", "refresh_token", "expires_at", "metadata", "updated_at" FROM `workspace_integrations`;--> statement-breakpoint
DROP TABLE `workspace_integrations`;--> statement-breakpoint
ALTER TABLE `__new_workspace_integrations` RENAME TO `workspace_integrations`;--> statement-breakpoint
CREATE TABLE `__new_workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_workspace_members`("workspace_id", "user_id", "role", "created_at") SELECT "workspace_id", "user_id", "role", "created_at" FROM `workspace_members`;--> statement-breakpoint
DROP TABLE `workspace_members`;--> statement-breakpoint
ALTER TABLE `__new_workspace_members` RENAME TO `workspace_members`;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "name", "owner_user_id", "created_at", "updated_at") SELECT "id", "name", "owner_user_id", "created_at", "updated_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;