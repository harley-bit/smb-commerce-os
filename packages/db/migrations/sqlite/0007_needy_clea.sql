CREATE TABLE `deposit_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`state` text NOT NULL,
	`authorized_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`captured_minor` integer,
	`released_at` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`raw_event_json` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_provider_ref_unique` ON `payments` (`provider`,`provider_ref`);