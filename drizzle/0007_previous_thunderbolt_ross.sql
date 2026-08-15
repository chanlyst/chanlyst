ALTER TABLE `prospects` ADD `stage` text DEFAULT 'discovered' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `contacted_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `replied_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `meeting_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `converted_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `revenue_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `outcome_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `prospects`
SET `stage` = 'queued'
WHERE EXISTS (
  SELECT 1 FROM `outbound_messages`
  WHERE `outbound_messages`.`lead_id` = `prospects`.`id`
    AND `outbound_messages`.`status` = 'queued'
);--> statement-breakpoint
UPDATE `prospects`
SET `stage` = 'contacted',
    `contacted_at` = COALESCE(
      (
        SELECT MIN(`outbound_messages`.`sent_at`)
        FROM `outbound_messages`
        WHERE `outbound_messages`.`lead_id` = `prospects`.`id`
          AND `outbound_messages`.`status` = 'sent'
      ),
      `updated_at`
    )
WHERE EXISTS (
  SELECT 1 FROM `outbound_messages`
  WHERE `outbound_messages`.`lead_id` = `prospects`.`id`
    AND `outbound_messages`.`status` = 'sent'
);
