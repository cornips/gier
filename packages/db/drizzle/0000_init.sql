CREATE TABLE `advice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`text` text NOT NULL,
	`ai_call_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_call_id`) REFERENCES `ai_calls`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`cost_eur` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_calls_product_idx` ON `ai_calls` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`kind` text NOT NULL,
	`threshold_cents` integer,
	`percent` real,
	`active` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `discovery_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`query` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`stage` text DEFAULT 'search' NOT NULL,
	`stats` text,
	`candidates` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exclusion_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`term` text NOT NULL,
	`category` text,
	`count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exclusion_term_category_idx` ON `exclusion_rules` (`term`,`category`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`pack_count` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`followed_automatically` integer DEFAULT false NOT NULL,
	`last_checked_at` integer,
	`next_check_at` integer,
	`fail_streak` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_product_url_idx` ON `listings` (`product_id`,`url`);--> statement-breakpoint
CREATE INDEX `listings_next_check_idx` ON `listings` (`next_check_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`data` text,
	`delivered_via` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `price_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`shipping_cents` integer,
	`in_stock` integer DEFAULT true NOT NULL,
	`reference_cents` integer,
	`reference_type` text DEFAULT 'none' NOT NULL,
	`claimed_discount_pct` integer,
	`deal_label` text,
	`is_heartbeat` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_points_listing_idx` ON `price_points` (`listing_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`category` text,
	`gtin` text,
	`image_url` text,
	`fingerprint` text NOT NULL,
	`compare_unit` text DEFAULT 'piece' NOT NULL,
	`ai_budget_tier` text DEFAULT 'frugal' NOT NULL,
	`advice_mode` text DEFAULT 'auto' NOT NULL,
	`target_price_cents` integer,
	`notes` text,
	`last_discovery_at` integer,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `search_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`query` text NOT NULL,
	`results` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`category` text DEFAULT 'unknown' NOT NULL,
	`is_fixed` integer DEFAULT false NOT NULL,
	`trust` text DEFAULT 'doubt' NOT NULL,
	`origin` text DEFAULT 'learned' NOT NULL,
	`extraction` text DEFAULT 'jsonld' NOT NULL,
	`selectors` text,
	`rules` text,
	`search_url` text,
	`requires_login` integer DEFAULT false NOT NULL,
	`session_encrypted` text,
	`session_updated_at` integer,
	`domain_age_days` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`needs_research` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_domain_idx` ON `stores` (`domain`);