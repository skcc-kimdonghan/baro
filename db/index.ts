import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Local SQLite/D1 binding `DB` is unavailable. Restart the app with the 바로발행 desktop shortcut."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1Database() {
  if (!env.DB) {
    throw new Error("Local D1 binding `DB` is unavailable.");
  }
  return env.DB;
}
