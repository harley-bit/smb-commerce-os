CREATE TABLE `listing_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`mode` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`attributes_json` text,
	`price_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`duration_minutes` integer,
	`rate_period` text,
	`deposit_minor` integer,
	`archived_at` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "listing_variants_mode_fields_check" CHECK((
        ("listing_variants"."mode" = 'PRODUCT' AND "listing_variants"."duration_minutes" IS NULL AND "listing_variants"."rate_period" IS NULL AND "listing_variants"."deposit_minor" IS NULL)
        OR ("listing_variants"."mode" = 'SERVICE' AND "listing_variants"."rate_period" IS NULL AND "listing_variants"."deposit_minor" IS NULL)
        OR ("listing_variants"."mode" = 'RENTAL' AND "listing_variants"."duration_minutes" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_merchant_slug_unique` ON `listings` (`merchant_id`,`slug`);