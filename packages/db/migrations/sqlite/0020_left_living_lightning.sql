CREATE TABLE `checkout_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`customer_user_id` text NOT NULL,
	`terms_version` text NOT NULL,
	`consented_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `checkout_consents_merchant_order_idx` ON `checkout_consents` (`merchant_id`,`order_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `contact_phone` text;