ALTER TABLE `prospects` ADD `opportunity_type` text DEFAULT 'partner' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `action_type` text DEFAULT 'propose_partnership' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `next_action` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `action_url` text DEFAULT '' NOT NULL;
