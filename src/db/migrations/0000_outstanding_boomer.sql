CREATE TABLE `card_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`scryfall_id` text,
	`card_name` text NOT NULL,
	`card_name_normalized` text NOT NULL,
	`card_set` text,
	`card_image_url` text,
	`resolved` integer DEFAULT 0 NOT NULL,
	`resolved_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `card_cache_normalized_idx` ON `card_cache` (`card_name_normalized`);--> statement-breakpoint
CREATE TABLE `digest_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`trigger` text NOT NULL,
	`listing_count` integer NOT NULL,
	`listing_ids_included` text NOT NULL,
	`delivery_results` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`listing_type` text NOT NULL,
	`game` text DEFAULT 'mtg' NOT NULL,
	`card_name` text NOT NULL,
	`card_name_normalized` text NOT NULL,
	`card_set` text,
	`card_image_url` text,
	`condition` text,
	`price_cents` integer,
	`quantity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listings_search_idx` ON `listings` (`server_id`,`status`,`card_name_normalized`);--> statement-breakpoint
CREATE INDEX `listings_digest_idx` ON `listings` (`server_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `listings_user_idx` ON `listings` (`server_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_channel_id` text,
	`digest_dm_user_id` text,
	`digest_mode` text DEFAULT 'disabled' NOT NULL,
	`digest_cron` text DEFAULT '0 9 * * *' NOT NULL,
	`digest_timezone` text DEFAULT 'UTC' NOT NULL,
	`last_digest_at` integer,
	`enabled_games` text DEFAULT '["mtg"]' NOT NULL,
	`removed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
