CREATE TABLE `club_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`club_name` text NOT NULL,
	`membership_number` text,
	`expires_on` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_club_memberships_user_id` ON `club_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `storage_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`capacity_kg` real DEFAULT 0 NOT NULL,
	`permit_number` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_storage_sites_user_id` ON `storage_sites` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_certifications` (
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
	CONSTRAINT "ck_certifications_certifying_body" CHECK("certifying_body" IS NULL OR "certifying_body" IN ('NAR', 'TRA', 'ARA')),
	CONSTRAINT "ck_certifications_level" CHECK("level" IS NULL OR "level" IN (0, 1, 2, 3))
);
--> statement-breakpoint
INSERT INTO `__new_certifications`("id", "user_id", "certifying_body", "level", "cert_number", "expires_on", "verified_at", "override_reason", "created_at", "updated_at", "created_by", "deleted_at") SELECT "id", "user_id", "certifying_body", "level", "cert_number", "expires_on", "verified_at", "override_reason", "created_at", "updated_at", "created_by", "deleted_at" FROM `certifications`;--> statement-breakpoint
DROP TABLE `certifications`;--> statement-breakpoint
ALTER TABLE `__new_certifications` RENAME TO `certifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_certifications_user_id` ON `certifications` (`user_id`);--> statement-breakpoint
ALTER TABLE `flights` ADD `rso_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `flights` ADD `lco_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `flights` ADD `rso_name` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `lco_name` text;--> statement-breakpoint
ALTER TABLE `launch_events` ADD `launch_director` text;--> statement-breakpoint
ALTER TABLE `launch_events` ADD `tripoli_prefect` text;--> statement-breakpoint
ALTER TABLE `rocket_configurations` ADD `length_mm` real;--> statement-breakpoint
ALTER TABLE `rocket_configurations` ADD `body_diameter_mm` real;--> statement-breakpoint
ALTER TABLE `rockets` ADD `length_mm` real;--> statement-breakpoint
ALTER TABLE `rockets` ADD `body_diameter_mm` real;