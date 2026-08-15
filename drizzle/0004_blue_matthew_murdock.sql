ALTER TABLE `products` ADD `monetization_model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `paid_offer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `price_range` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `payment_point` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `conversion_event` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `attribution_method` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `partner_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `products`
SET
  `monetization_model` = 'Подписка и платные лимиты',
  `paid_offer` = 'Расширенные лимиты сообщений, изображений, памяти и premium-функции',
  `payment_point` = 'Внутри Telegram-бота',
  `conversion_event` = 'Успешная первая оплата',
  `attribution_method` = 'Telegram deep-link, partner ID и payment postback',
  `partner_terms` = 'Revenue share или CPA за подтверждённого платящего пользователя'
WHERE `website` LIKE '%naughtytalk.chat%';
