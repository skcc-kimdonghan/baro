import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getLocalDataStatePath() {
  const override = process.env.BARO_PUBLISH_DATA_DIR?.trim();
  return override || join(homedir(), "Library", "Application Support", "바로발행", "database");
}

export function ensureLocalDataStatePath() {
  const directory = getLocalDataStatePath();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Local database path must be a private directory.");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("Local database path must be owned by the current user.");
  }
  chmodSync(directory, 0o700);
  return directory;
}
