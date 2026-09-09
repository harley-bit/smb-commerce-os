CREATE TABLE `push_device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`customer_user_id` text NOT NULL,
	`platform` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `push_device_tokens_merchant_customer_idx` ON `push_device_tokens` (`merchant_id`,`customer_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_device_tokens_merchant_token_idx` ON `push_device_tokens` (`merchant_id`,`token`);