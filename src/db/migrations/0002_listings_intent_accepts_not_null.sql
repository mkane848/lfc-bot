PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`intent` text NOT NULL,
	`accepts` text NOT NULL,
	`game` text DEFAULT 'mtg' NOT NULL,
	`card_name` text NOT NULL,
	`card_name_normalized` text NOT NULL,
	`card_set` text,
	`card_image_url` text,
	`finish` text,
	`variant` text,
	`collector_number` text,
	`manapool_url` text,
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
INSERT INTO `__new_listings`("id", "server_id", "user_id", "username", "intent", "accepts", "game", "card_name", "card_name_normalized", "card_set", "card_image_url", "finish", "variant", "collector_number", "manapool_url", "condition", "price_cents", "quantity", "notes", "status", "expires_at", "created_at", "updated_at") SELECT "id", "server_id", "user_id", "username", "intent", "accepts", "game", "card_name", "card_name_normalized", "card_set", "card_image_url", "finish", "variant", "collector_number", "manapool_url", "condition", "price_cents", "quantity", "notes", "status", "expires_at", "created_at", "updated_at" FROM `listings`;--> statement-breakpoint
DROP TABLE `listings`;--> statement-breakpoint
ALTER TABLE `__new_listings` RENAME TO `listings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `listings_search_idx` ON `listings` (`server_id`,`status`,`card_name_normalized`);--> statement-breakpoint
CREATE INDEX `listings_digest_idx` ON `listings` (`server_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `listings_user_idx` ON `listings` (`server_id`,`user_id`,`created_at`);