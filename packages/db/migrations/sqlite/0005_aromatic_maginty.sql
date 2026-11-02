CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`order_line_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`quantity` integer NOT NULL,
	`state` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reservations_subject_interval_idx` ON `reservations` (`merchant_id`,`subject_type`,`subject_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `reservations_state_expires_idx` ON `reservations` (`state`,`expires_at`);