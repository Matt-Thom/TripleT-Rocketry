CREATE TABLE `components` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`motor_id` text,
	`manufacturer` text,
	`part_number` text,
	`serial_number` text,
	`lot_number` text,
	`quantity_on_hand` integer DEFAULT 0 NOT NULL,
	`quantity_allocated` integer DEFAULT 0 NOT NULL,
	`quantity_expended` integer DEFAULT 0 NOT NULL,
	`quantity_disposed` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`condition` text DEFAULT 'new' NOT NULL,
	`storage_location` text,
	`hazard_class` text,
	`propellant_mass_g` real,
	`acquired_on` text,
	`purchased_on` text,
	`received_on` text,
	`cost_cents` integer,
	`vendor` text,
	`expiration_date` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_id`) REFERENCES `motors`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_components_category" CHECK("category" IS NULL OR "category" IN ('motor', 'casing', 'recovery', 'avionics', 'pyrotechnic', 'airframe', 'hardware', 'payload', 'other')),
	CONSTRAINT "ck_components_condition" CHECK("condition" IS NULL OR "condition" IN ('new', 'good', 'fair', 'damaged', 'quarantined', 'retired'))
);
--> statement-breakpoint
CREATE INDEX `ix_components_user_id` ON `components` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_components_category` ON `components` (`category`);--> statement-breakpoint
CREATE TABLE `inventory_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`motor_inventory_id` text,
	`component_id` text,
	`transaction_type` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`transaction_date` text NOT NULL,
	`counterparty_name` text,
	`counterparty_cert_number` text,
	`counterparty_license` text,
	`counterparty_contact` text,
	`reference_id` text,
	`flight_id` text,
	`batch_lot_number` text,
	`serial_numbers` text,
	`storage_location` text,
	`unit_cost` real,
	`witness_name` text,
	`compliance_notes` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motor_inventory_id`) REFERENCES `motor_inventories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_inventory_transactions_type" CHECK("transaction_type" IS NULL OR "transaction_type" IN ('purchased', 'received', 'used', 'sold', 'transferred_in', 'transferred_out', 'disposed', 'destroyed', 'lost', 'stolen', 'quarantined', 'returned', 'loaned_out', 'borrowed', 'audit_adjustment'))
);
--> statement-breakpoint
CREATE INDEX `ix_inventory_transactions_user_id` ON `inventory_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_inventory_transactions_motor_inv_id` ON `inventory_transactions` (`motor_inventory_id`);--> statement-breakpoint
CREATE INDEX `ix_inventory_transactions_component_id` ON `inventory_transactions` (`component_id`);--> statement-breakpoint
CREATE INDEX `ix_inventory_transactions_type` ON `inventory_transactions` (`transaction_type`);--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `sold_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `disposed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `purchased_on` text;--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `received_on` text;--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `batch_lot_number` text;--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `serial_number` text;--> statement-breakpoint
ALTER TABLE `motor_inventories` ADD `storage_location` text;