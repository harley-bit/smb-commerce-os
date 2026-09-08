CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`unit_id` text,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` integer NOT NULL,
	`order_line_id` text,
	`occurred_at` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`note` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `listing_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_units` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`unit_code` text NOT NULL,
	`tracking_mode` text NOT NULL,
	`status` text NOT NULL,
	`acquisition_cost_minor` integer,
	`acquired_at` text,
	`expected_life_months` integer,
	`condition_grade` text,
	`retired_at` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `listing_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_units_merchant_unit_code_unique` ON `inventory_units` (`merchant_id`,`unit_code`);