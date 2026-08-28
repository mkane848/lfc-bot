ALTER TABLE `card_cache` ADD `collector_number` text;--> statement-breakpoint
ALTER TABLE `card_cache` ADD `manapool_url` text;--> statement-breakpoint
ALTER TABLE `card_cache` ADD `manapool_price_cents` integer;--> statement-breakpoint
ALTER TABLE `listings` ADD `intent` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `accepts` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `finish` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `variant` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `collector_number` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `manapool_url` text;--> statement-breakpoint
UPDATE `listings` SET
  `intent` = CASE `listing_type` WHEN 'buy' THEN 'want' ELSE 'have' END,
  `accepts` = CASE `listing_type` WHEN 'trade' THEN 'trade' ELSE 'cash' END;