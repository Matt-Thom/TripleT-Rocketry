ALTER TABLE `launch_events` ADD `rso_name` text;--> statement-breakpoint
ALTER TABLE `launch_events` ADD `lco_name` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `log_type` text DEFAULT 'actual' NOT NULL;--> statement-breakpoint
ALTER TABLE `flights` ADD `is_first_flight` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `flights` ADD `cert_attempt` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `flights` ADD `build_type` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `stability_check_method` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `stability_margin` real;--> statement-breakpoint
ALTER TABLE `flights` ADD `motor_type` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `total_weight_g` real;--> statement-breakpoint
ALTER TABLE `flights` ADD `recovery_system` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `recovery_size` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `deployment_method` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `main_deploy_altitude` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `pad_number` text;