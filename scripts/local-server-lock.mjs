import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

const LOCK_COMMAND = "/usr/bin/lockf";
const FORWARDED_SIGNALS = new Set(["SIGINT", "SIGTERM"]);
const LOCKED_COMMAND_PID_PATH = "BARO_PUBLISH_LOCKED_COMMAND_PID_PATH";
const lockedCommandMetadata = new WeakMap();

export function ensureLocalServerLockPath() {
  const directory = join(homedir(), "Library", "Application Support", "바로발행");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStats = lstatSync(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("Local server lock directory must be a private directory.");
  }
  if (typeof process.getuid === "function" && directoryStats.uid !== process.getuid()) {
    throw new Error("Local server lock directory must be owned by the current user.");
  }
  chmodSync(directory, 0o700);

  const lockPath = join(directory, "server.lock");
  const descriptor = openSync(
    lockPath,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const lockStats = fstatSync(descriptor);
    if (!lockStats.isFile()) throw new Error("Local server lock must be a regular file.");
    if (typeof process.getuid === "function" && lockStats.uid !== process.getuid()) {
      throw new Error("Local server lock must be owned by the current user.");
    }
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
  return lockPath;
}

export function acquireLocalServerLock({ lockPath, command, args, env, stdio = "inherit" }) {
  if (!isAbsolute(lockPath) || !isAbsolute(command) || !Array.isArray(args)) {
    throw new Error("Invalid local server lock command.");
  }
  const pidPath = join(
    dirname(lockPath),
    `.${basename(lockPath)}.${process.pid}.${randomBytes(8).toString("hex")}.pid`,
  );
  const lockProcess = spawn(LOCK_COMMAND, ["-k", "-t", "0", lockPath, command, ...args], {
    env: { ...env, [LOCKED_COMMAND_PID_PATH]: pidPath },
    stdio,
  });
  lockedCommandMetadata.set(lockProcess, Object.freeze({ pidPath }));
  lockProcess.once("exit", () => rmSync(pidPath, { force: true }));
  return lockProcess;
}

export function registerLockedCommandProcess() {
  const pidPath = process.env[LOCKED_COMMAND_PID_PATH]?.trim();
  Reflect.deleteProperty(process.env, LOCKED_COMMAND_PID_PATH);
  if (!pidPath || !isAbsolute(pidPath)) return false;
  const temporaryPath = `${pidPath}.${randomBytes(8).toString("hex")}.tmp`;
  const descriptor = openSync(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, `${process.pid}\n`, { encoding: "utf8" });
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, pidPath);
  return true;
}

export async function forwardSignalToLockedCommand(lockProcess, signal) {
  if (!FORWARDED_SIGNALS.has(signal) || !Number.isSafeInteger(lockProcess?.pid)) {
    throw new Error("Invalid locked server signal request.");
  }
  const metadata = lockedCommandMetadata.get(lockProcess);
  if (!metadata) throw new Error("Unknown locked server process.");
  while (true) {
    try {
      const childPid = Number(readFileSync(metadata.pidPath, "utf8").trim());
      if (!Number.isSafeInteger(childPid) || childPid <= 1) {
        throw new Error("Invalid locked server process id.");
      }
      process.kill(childPid, signal);
      return true;
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes(error?.code)) throw error;
    }
    if (lockProcess.exitCode !== null || lockProcess.signalCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
