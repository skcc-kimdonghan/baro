import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const articleBundles = sqliteTable("article_bundles", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  sourceText: text("source_text").notNull(),
  headerColor: text("header_color").notNull(),
  articleType: text("article_type").notNull().default("information"),
  articleTitlesJson: text("article_titles_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("article_bundles_updated_at_idx").on(table.updatedAt, table.id)]);

export const publicationHistory = sqliteTable("publication_history", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  title: text("title").notNull(),
  preparedText: text("prepared_text").notNull(),
  publishedText: text("published_text").notNull(),
  comparisonJson: text("comparison_json"),
  completedAt: text("completed_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("publication_history_completed_at_idx").on(table.completedAt, table.id)]);

export const gptShortcuts = sqliteTable("gpt_shortcuts", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("gpt_shortcuts_name_idx").on(table.name),
  uniqueIndex("gpt_shortcuts_url_idx").on(table.url),
]);

export const collectionRevisions = sqliteTable("collection_revisions", {
  collection: text("collection").primaryKey(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const localDataImports = sqliteTable("local_data_imports", {
  migrationId: text("migration_id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  resultJson: text("result_json").notNull(),
  completedAt: text("completed_at").notNull(),
});
