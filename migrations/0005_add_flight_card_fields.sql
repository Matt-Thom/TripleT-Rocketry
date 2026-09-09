PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_flights` (
	`id` text PRIMARY KEY NOT NULL,
	`flyer_id` text NOT NULL,
	`rocket_configuration_id` text,
	`motor_id` text,
	`motor_inventory_id` text,
	`launch_site_id` text,
	`launch_event_id` text,
	`flight_number` integer,
	`flown_at` integer,
	`log_type` text DEFAULT 'actual' NOT NULL,
	`altitude_agl_m` real,
	`altitude_msl_m` real,
	`max_velocity_mps` real,
	`max_accel_g` real,
	`wind_mps` real,
	`wind_dir_deg` real,
	`temperature_c` real,
	`visibility_m` real,
	`ceiling_m` real,
	`outcome` text,
	`notes` text,
	`media_urls` text,
	`soft_gate_warnings` text,
	`proceeded_despite_warnings` integer DEFAULT false NOT NULL,
	`rso_user_id` text,
	`lco_user_id` text,
	`rso_name` text,
	`lco_name` text,
	`is_first_flight` integer DEFAULT false NOT NULL,
	`cert_attempt` text DEFAULT 'none' NOT NULL,
	`build_type` text,
	`stability_check_method` text,
	`stability_margin` real,
	`motor_type` text,
	`total_weight_g` real,
	`recovery_system` text,
	`recovery_size` text,
	`deployment_method` text,
	`main_deploy_altitude` text,
	`pad_number` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`flyer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rocket_configuration_id`) REFERENCES `rocket_configurations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `motors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_inventory_id`) REFERENCES `motor_inventories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_site_id`) REFERENCES `launch_sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_event_id`) REFERENCES `launch_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rso_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lco_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_flights_outcome" CHECK("outcome" IS NULL OR "outcome" IN ('successful', 'cato', 'separation', 'recovery_failure', 'tree', 'powerline', 'lost', 'other', 'GOOD', 'CATO', 'Shred', 'Unstable', 'Zipper', 'Separation', 'No chute', 'Tangled', 'Lawn Dart', 'Retention fail', 'No ignition'))
);--> statement-breakpoint
INSERT INTO `__new_flights` (
	`id`, `flyer_id`, `rocket_configuration_id`, `motor_id`, `motor_inventory_id`,
	`launch_site_id`, `launch_event_id`, `flight_number`, `flown_at`, `log_type`,
	`altitude_agl_m`, `altitude_msl_m`, `max_velocity_mps`, `max_accel_g`,
	`wind_mps`, `wind_dir_deg`, `temperature_c`, `visibility_m`, `ceiling_m`,
	`outcome`, `notes`, `media_urls`, `soft_gate_warnings`, `proceeded_despite_warnings`,
	`rso_user_id`, `lco_user_id`, `rso_name`, `lco_name`,
	`created_at`, `updated_at`, `created_by`, `deleted_at`
) SELECT 
	`id`, `flyer_id`, `rocket_configuration_id`, `motor_id`, `motor_inventory_id`,
	`launch_site_id`, `launch_event_id`, `flight_number`, `flown_at`, `log_type`,
	`altitude_agl_m`, `altitude_msl_m`, `max_velocity_mps`, `max_accel_g`,
	`wind_mps`, `wind_dir_deg`, `temperature_c`, `visibility_m`, `ceiling_m`,
	`outcome`, `notes`, `media_urls`, `soft_gate_warnings`, `proceeded_despite_warnings`,
	`rso_user_id`, `lco_user_id`, `rso_name`, `lco_name`,
	`created_at`, `updated_at`, `created_by`, `deleted_at`
FROM `flights`;--> statement-breakpoint
DROP TABLE `flights`;--> statement-breakpoint
ALTER TABLE `__new_flights` RENAME TO `flights`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_flights_flyer_id` ON `flights` (`flyer_id`);--> statement-breakpoint
CREATE INDEX `ix_flights_flown_at` ON `flights` (`flown_at`);--> statement-breakpoint
ALTER TABLE `launch_events` ADD `rso_name` text;--> statement-breakpoint
ALTER TABLE `launch_events` ADD `lco_name` text;
