CREATE TABLE `ai_usage` (
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
	`created_at` text NOT NULL
);
