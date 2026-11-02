PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_listing_variants` (
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
	`buffer_minutes` integer,
	`archived_at` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "listing_variants_mode_fields_check" CHECK((
        ("__new_listing_variants"."mode" = 'PRODUCT' AND "__new_listing_variants"."duration_minutes" IS NULL AND "__new_listing_variants"."rate_period" IS NULL AND "__new_listing_variants"."deposit_minor" IS NULL AND "__new_listing_variants"."buffer_minutes" IS NULL)
        OR ("__new_listing_variants"."mode" = 'SERVICE' AND "__new_listing_variants"."rate_period" IS NULL AND "__new_listing_variants"."deposit_minor" IS NULL AND "__new_listing_variants"."buffer_minutes" IS NULL)
        OR ("__new_listing_variants"."mode" = 'RENTAL' AND "__new_listing_variants"."duration_minutes" IS NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_listing_variants`("id", "merchant_id", "listing_id", "mode", "sku", "name", "attributes_json", "price_minor", "currency", "duration_minutes", "rate_period", "deposit_minor", "buffer_minutes", "archived_at") SELECT "id", "merchant_id", "listing_id", "mode", "sku", "name", "attributes_json", "price_minor", "currency", "duration_minutes", "rate_period", "deposit_minor", NULL, "archived_at" FROM `listing_variants`;--> statement-breakpoint
DROP TABLE `listing_variants`;--> statement-breakpoint
ALTER TABLE `__new_listing_variants` RENAME TO `listing_variants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;