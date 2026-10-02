CREATE INDEX `article_bundles_updated_at_idx` ON `article_bundles` (`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gpt_shortcuts_name_idx` ON `gpt_shortcuts` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `gpt_shortcuts_url_idx` ON `gpt_shortcuts` (`url`);--> statement-breakpoint
CREATE INDEX `publication_history_completed_at_idx` ON `publication_history` (`completed_at`,`id`);--> statement-breakpoint
INSERT OR IGNORE INTO `collection_revisions` (`collection`, `revision`, `updated_at`)
VALUES ('articleBundles', 0, '1970-01-01T00:00:00.000Z');--> statement-breakpoint
INSERT OR IGNORE INTO `collection_revisions` (`collection`, `revision`, `updated_at`)
VALUES ('publicationHistory', 0, '1970-01-01T00:00:00.000Z');--> statement-breakpoint
INSERT OR IGNORE INTO `collection_revisions` (`collection`, `revision`, `updated_at`)
VALUES ('shortcuts', 0, '1970-01-01T00:00:00.000Z');
