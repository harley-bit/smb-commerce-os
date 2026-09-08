CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`seq` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`ip` text,
	`user_agent` text,
	`occurred_at` text NOT NULL,
	`prev_hash` text NOT NULL,
	`row_hash` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
