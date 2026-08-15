ALTER TABLE `prospects` ADD `site_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `site_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `relevance` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospects` ADD `relevance_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- The citation rule is gone, so its marker means nothing now: those channels
-- were never doubted for a reason that held up. They become ordinary
-- discovered channels and are judged, like the rest, on the next run.
UPDATE `prospects` SET `origin` = 'discovered' WHERE `origin` = 'discovered_unverified';
