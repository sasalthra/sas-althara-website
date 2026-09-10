CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`property_id` text NOT NULL,
	`stage` text DEFAULT 'new' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`follow_up` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leads_owner_created_idx` ON `leads` (`owner`,`created_at`);