CREATE TABLE `article_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`source_text` text NOT NULL,
	`header_color` text NOT NULL,
	`article_titles_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_revisions` (
	`collection` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gpt_shortcuts` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_data_imports` (
	`migration_id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publication_history` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`title` text NOT NULL,
	`prepared_text` text NOT NULL,
	`published_text` text NOT NULL,
	`comparison_json` text,
	`completed_at` text NOT NULL,
	`updated_at` text NOT NULL
);
