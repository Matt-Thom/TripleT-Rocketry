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
ALTER TABLE `users` ADD `role` text DEFAULT 'flyer' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `regulatory_region` text DEFAULT 'SA' NOT NULL;