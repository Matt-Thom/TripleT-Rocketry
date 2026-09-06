CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sessions_token` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `ix_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`friendly_name` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_user_credentials_user_id` ON `user_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `motors` ADD `part_number` text;--> statement-breakpoint
ALTER TABLE `motors` ADD `hardware` text;--> statement-breakpoint
ALTER TABLE `motors` ADD `grains` integer;--> statement-breakpoint
ALTER TABLE `motors` ADD `propellant_weight_g` real;--> statement-breakpoint
ALTER TABLE `motors` ADD `grain_weight_g` real;--> statement-breakpoint
ALTER TABLE `motors` ADD `un_number` text;--> statement-breakpoint
ALTER TABLE `motors` ADD `hazard_classification` text;--> statement-breakpoint
ALTER TABLE `motors` ADD `usps_mailable` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `motors` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `rocket_configurations` ADD `drogue_parachute_size_mm` real;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'flyer' NOT NULL,
	`regulatory_region` text DEFAULT 'SA' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "ck_users_role" CHECK("role" IS NULL OR "role" IN ('admin', 'flyer'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "display_name", "password_hash", "role", "regulatory_region", "is_active", "created_at", "updated_at") SELECT "id", "email", "display_name", "password_hash", "role", "regulatory_region", "is_active", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);