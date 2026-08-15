ALTER TABLE `prospects` ADD `record_kind` text DEFAULT 'channel' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prospects` ADD `parent_channel_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `prospects_workspace_kind_idx`
ON `prospects` (`workspace_id`, `product_id`, `record_kind`);
