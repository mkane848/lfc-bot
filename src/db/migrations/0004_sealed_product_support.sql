CREATE TABLE `sealed_cache` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`set_code` text NOT NULL,
	`category` text NOT NULL,
	`subtype` text,
	`release_date` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sealed_cache_normalized_idx` ON `sealed_cache` (`name_normalized`);--> statement-breakpoint
CREATE INDEX `sealed_cache_set_idx` ON `sealed_cache` (`set_code`);--> statement-breakpoint
CREATE TABLE `sealed_catalog_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`build_version` text,
	`set_list_etag` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `listings` ADD `kind` text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `sealed_uuid` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `sealed_category` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `sealed_subtype` text;