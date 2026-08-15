ALTER TABLE `prospects` ADD `origin` text DEFAULT 'discovered' NOT NULL;
--> statement-breakpoint
UPDATE `prospects`
SET `origin` = 'curated'
WHERE `id` LIKE `product_id` || ':%'
  AND `product_id` IN (
    SELECT `id` FROM `products`
    WHERE `website` LIKE '%naughtytalk.chat%'
  );
