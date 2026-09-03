CREATE TABLE `certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`certifying_body` text NOT NULL,
	`level` integer NOT NULL,
	`cert_number` text,
	`expires_on` text,
	`verified_at` integer,
	`override_reason` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_certifications_certifying_body" CHECK("certifying_body" IS NULL OR "certifying_body" IN ('NAR', 'TRA')),
	CONSTRAINT "ck_certifications_level" CHECK("level" IS NULL OR "level" IN (1, 2, 3))
);
--> statement-breakpoint
CREATE INDEX `ix_certifications_user_id` ON `certifications` (`user_id`);--> statement-breakpoint
CREATE TABLE `flights` (
	`id` text PRIMARY KEY NOT NULL,
	`flyer_id` text NOT NULL,
	`rocket_configuration_id` text,
	`motor_id` text,
	`motor_inventory_id` text,
	`launch_site_id` text,
	`launch_event_id` text,
	`flight_number` integer,
	`flown_at` integer,
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
	CONSTRAINT "ck_flights_outcome" CHECK("outcome" IS NULL OR "outcome" IN ('successful', 'cato', 'separation', 'recovery_failure', 'tree', 'powerline', 'lost', 'other'))
);
--> statement-breakpoint
CREATE INDEX `ix_flights_flyer_id` ON `flights` (`flyer_id`);--> statement-breakpoint
CREATE INDEX `ix_flights_flown_at` ON `flights` (`flown_at`);--> statement-breakpoint
CREATE TABLE `launch_events` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_site_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`rso_user_id` text,
	`lco_user_id` text,
	`weather_notes` text,
	`pad_count` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`launch_site_id`) REFERENCES `launch_sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rso_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lco_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_launch_events_launch_site_id` ON `launch_events` (`launch_site_id`);--> statement-breakpoint
CREATE TABLE `launch_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`max_altitude_agl_m` real,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `motor_inventories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`motor_id` text NOT NULL,
	`quantity_on_hand` integer DEFAULT 0 NOT NULL,
	`expended_count` integer DEFAULT 0 NOT NULL,
	`acquired_on` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `motors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_motor_inventories_user_id` ON `motor_inventories` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_motor_inventories_motor_id` ON `motor_inventories` (`motor_id`);--> statement-breakpoint
CREATE TABLE `motors` (
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer` text NOT NULL,
	`model` text NOT NULL,
	`impulse_class` text,
	`total_impulse_ns` real,
	`average_thrust_n` real,
	`max_thrust_n` real,
	`burn_time_s` real,
	`delay_s` real,
	`propellant_type` text,
	`diameter_mm` real,
	`length_mm` real,
	`casing_reusable` integer DEFAULT false NOT NULL,
	`cert_number` text,
	`certifying_org` text,
	`weight_g` real,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	CONSTRAINT "ck_motors_impulse_class" CHECK("impulse_class" IS NULL OR "impulse_class" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O')),
	CONSTRAINT "ck_motors_propellant_type" CHECK("propellant_type" IS NULL OR "propellant_type" IN ('black_powder', 'apcp', 'hybrid', 'other')),
	CONSTRAINT "ck_motors_certifying_org" CHECK("certifying_org" IS NULL OR "certifying_org" IN ('NAR', 'TRA', 'BOTH', 'NONE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motors_manufacturer_model_delay` ON `motors` (`manufacturer`,`model`,`delay_s`);--> statement-breakpoint
CREATE TABLE `rocket_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`rocket_id` text NOT NULL,
	`version` integer NOT NULL,
	`airframe_material` text,
	`fin_count` integer,
	`dry_mass_g` real,
	`loaded_mass_g` real,
	`ballast_g` real,
	`cg_mm` real,
	`cp_mm` real,
	`stability_calibers` real,
	`recovery_type` text,
	`parachute_size_mm` real,
	`motor_mount_diameter_mm` real,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`rocket_id`) REFERENCES `rockets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_rocket_configurations_recovery_type" CHECK("recovery_type" IS NULL OR "recovery_type" IN ('parachute', 'streamer', 'dual_deploy', 'tumble', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rocket_configurations_rocket_version` ON `rocket_configurations` (`rocket_id`,`version`);--> statement-breakpoint
CREATE TABLE `rockets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'in_build' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_rockets_status" CHECK("status" IS NULL OR "status" IN ('flight_ready', 'in_build', 'damaged', 'retired'))
);
--> statement-breakpoint
CREATE INDEX `ix_rockets_owner_id` ON `rockets` (`owner_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);