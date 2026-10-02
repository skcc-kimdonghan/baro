import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function getLocalAccessTokenPath() {
  return join(homedir(), "Library", "Application Support", "바로발행", "access-token");
}

export function getLocalAccessEnvPath() {
  return join(homedir(), "Library", "Application Support", "바로발행", "worker.env");
}

function readValidatedToken(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Local access token must be a private regular file.");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("Local access token must be owned by the current user.");
  }
  chmodSync(path, 0o400);
  const token = readFileSync(path, "utf8").trim();
  if (!TOKEN_PATTERN.test(token)) throw new Error("Local access token is invalid.");
  return token;
}

export function ensureLocalAccessToken() {
  const path = getLocalAccessTokenPath();
  try {
    return readValidatedToken(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("hex");
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o400,
    );
    writeFileSync(descriptor, `${token}\n`, { encoding: "utf8" });
  } catch (error) {
    if (error?.code === "EEXIST") return readValidatedToken(path);
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return readValidatedToken(path);
}

export function rotateLocalAccessToken() {
  const path = getLocalAccessTokenPath();
  const token = randomBytes(32).toString("hex");
  const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o400,
    );
    writeFileSync(descriptor, `${token}\n`, { encoding: "utf8" });
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    chmodSync(path, 0o400);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return readValidatedToken(path);
}

export function createLocalBootstrapUrl({ token, port }) {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Local access token is invalid.");
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error("Local server port is invalid.");
  }
  return `http://localhost:${port}/#baro-token=${token}`;
}

export function ensureLocalAccessEnvFile(token) {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Local access token is invalid.");
  const path = getLocalAccessEnvPath();
  const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o400,
    );
    writeFileSync(descriptor, `BARO_PUBLISH_LOCAL_TOKEN=${token}\n`, { encoding: "utf8" });
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    chmodSync(path, 0o400);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return path;
}
