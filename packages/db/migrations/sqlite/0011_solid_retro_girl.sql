ALTER TABLE `reservations` ADD `created_by_account_id` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `created_by_ip` text;--> statement-breakpoint
CREATE INDEX `reservations_holder_account_idx` ON `reservations` (`merchant_id`,`state`,`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `reservations_holder_ip_idx` ON `reservations` (`merchant_id`,`state`,`created_by_ip`);