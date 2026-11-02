CREATE TABLE `listing_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_resources_merchant_listing_resource_unique` ON `listing_resources` (`merchant_id`,`listing_id`,`resource_id`);