CREATE TABLE `catalog_items` (
	`game` text NOT NULL,
	`kind` text NOT NULL,
	`language` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`base_normalized` text NOT NULL,
	`set_id` text NOT NULL,
	`number` text,
	`category` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`game`, `kind`, `language`, `id`)
);
--> statement-breakpoint
CREATE INDEX `catalog_items_name_idx` ON `catalog_items` (`game`,`kind`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `catalog_items_base_idx` ON `catalog_items` (`game`,`kind`,`base_normalized`);--> statement-breakpoint
CREATE INDEX `catalog_items_set_idx` ON `catalog_items` (`game`,`kind`,`set_id`);--> statement-breakpoint
CREATE TABLE `catalog_sets` (
	`game` text NOT NULL,
	`language` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`release_date` text,
	`supplemental` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`game`, `language`, `id`)
);
--> statement-breakpoint
CREATE INDEX `catalog_sets_code_idx` ON `catalog_sets` (`game`,`code`);--> statement-breakpoint
CREATE TABLE `catalog_sync_meta` (
	`source` text PRIMARY KEY NOT NULL,
	`fingerprint` text,
	`synced_at` integer NOT NULL
);
