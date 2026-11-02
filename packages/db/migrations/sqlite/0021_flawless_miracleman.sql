CREATE TABLE `deposit_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`customer_user_id` text NOT NULL,
	`hold_amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`hold_duration_days` integer NOT NULL,
	`acknowledged_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deposit_consents_merchant_order_line_idx` ON `deposit_consents` (`merchant_id`,`order_line_id`);