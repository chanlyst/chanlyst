ALTER TABLE `prospects` ADD `engagement_mode` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `commercial_model` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `pricing_summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `placement_requirements` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `usage_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `registration_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `outreach_eligible` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `prospects`
SET `engagement_mode` = CASE
  WHEN `opportunity_type` = 'paid_placement' OR `action_type` = 'request_media_kit'
    THEN 'paid_placement'
  WHEN `opportunity_type` = 'directory' OR `action_type` IN ('apply_listing', 'submit_product')
    THEN 'free_listing'
  ELSE 'outreach'
END,
`commercial_model` = CASE
  WHEN `opportunity_type` = 'paid_placement' OR `action_type` = 'request_media_kit'
    THEN 'paid'
  ELSE 'unknown'
END,
`outreach_eligible` = CASE
  WHEN `opportunity_type` = 'paid_placement'
    OR `opportunity_type` = 'directory'
    OR `action_type` IN ('request_media_kit', 'apply_listing', 'submit_product')
    THEN false
  ELSE true
END;--> statement-breakpoint
UPDATE `prospects`
SET `engagement_mode` = CASE
  WHEN `channel_type` LIKE '%Платн%' OR `channel_type` LIKE '%paid%'
    THEN 'paid_placement'
  ELSE 'free_listing'
END,
`commercial_model` = CASE
  WHEN `channel_type` LIKE '%Бесплат%' OR `channel_type` LIKE '%free%'
    THEN 'free'
  WHEN `channel_type` LIKE '%Платн%' OR `channel_type` LIKE '%paid%'
    THEN 'paid'
  ELSE 'unknown'
END,
`next_action` = CASE
  WHEN `channel_type` LIKE '%Платн%' OR `channel_type` LIKE '%paid%'
    THEN COALESCE(NULLIF(`next_action`, ''), 'Проверить тарифы и условия размещения.')
  ELSE COALESCE(NULLIF(`next_action`, ''), 'Подать продукт через форму площадки.')
END,
`registration_url` = COALESCE(NULLIF(`action_url`, ''), `url`),
`outreach_eligible` = false
WHERE `channel_type` LIKE '%каталог%'
  OR `channel_type` LIKE '%Каталог%'
  OR `channel_type` LIKE '%листинг%'
  OR `channel_type` LIKE '%Листинг%'
  OR `channel_type` LIKE '%заявка%'
  OR `channel_type` LIKE '%Заявка%';
