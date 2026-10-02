import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";
import {
  createLocalBootstrapUrl,
  ensureLocalAccessEnvFile,
  rotateLocalAccessToken,
} from "./local-access-token.mjs";
import { ensureLocalDataStatePath } from "./local-data-path.mjs";
import {
  acquireLocalServerLock,
  ensureLocalServerLockPath,
  forwardSignalToLockedCommand,
} from "./local-server-lock.mjs";
import { assertLocalServerPortAvailable } from "./local-server-port.mjs";

const LOCAL_SERVER_LOCK_MARKER = "BARO_PUBLISH_LOCAL_SERVER_LOCK_HELD";

function forwardSignalsTo(child, { lockedCommand = false } = {}) {
  let forwardingLockedSignal = false;
  const forwardSignal = (signal) => {
    if (child.killed) return;
    if (!lockedCommand) {
      child.kill(signal);
      return;
    }
    if (forwardingLockedSignal) return;
    forwardingLockedSignal = true;
    void forwardSignalToLockedCommand(child, signal)
      .catch((error) => {
        process.stderr.write(`LOCAL_SERVER_SIGNAL_FAILED: ${error instanceof Error ? error.message : "unknown error"}\n`);
      })
      .finally(() => {
        forwardingLockedSignal = false;
      });
  };
  const forwardTermination = () => forwardSignal("SIGTERM");
  const forwardInterrupt = () => forwardSignal("SIGINT");
  process.once("SIGTERM", forwardTermination);
  process.once("SIGINT", forwardInterrupt);
  return () => {
    process.removeListener("SIGTERM", forwardTermination);
    process.removeListener("SIGINT", forwardInterrupt);
  };
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(command)) throw new Error("Expected dev, build, or start.");
const managedLinux = readExecutionProfile() === "managed-linux";
Reflect.deleteProperty(process.env, "BARO_PUBLISH_LOCAL_TOKEN");
const localServerLockHeld = process.env[LOCAL_SERVER_LOCK_MARKER] === "1";
Reflect.deleteProperty(process.env, LOCAL_SERVER_LOCK_MARKER);
const serverPort = readFileSync(new URL("./server-port", import.meta.url), "utf8").trim();
if (!/^\d+$/.test(serverPort) || Number(serverPort) < 1024 || Number(serverPort) > 65535) {
  throw new Error("Invalid local server port configuration.");
}
if (!managedLinux && ["dev", "start"].includes(command) && args.some((argument) =>
  ["-p", "-H", "--port", "--host", "--hostname"].includes(argument)
  || argument.startsWith("--port=")
  || argument.startsWith("--host=")
  || argument.startsWith("--hostname="))) {
  throw new Error("LOCAL_SERVER_OPTION_OVERRIDE: port and hostname are fixed for the desktop launcher.");
}

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (!managedLinux && ["dev", "start"].includes(command) && !localServerLockHeld) {
  process.umask(0o077);
  const lockedChild = acquireLocalServerLock({
    lockPath: ensureLocalServerLockPath(),
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./locked-runner.mjs", import.meta.url)),
      fileURLToPath(import.meta.url),
      command,
      ...args,
    ],
    env: { ...process.env, [LOCAL_SERVER_LOCK_MARKER]: "1" },
  });
  const removeSignalForwarders = forwardSignalsTo(lockedChild, { lockedCommand: true });
  const status = await waitForChild(lockedChild);
  removeSignalForwarders();
  if (status.code === 75) {
    process.stderr.write("LOCAL_SERVER_ALREADY_RUNNING: another local startup owns the server lock.\n");
  }
  process.exit(status.code ?? 1);
}

let localDataStatePath = "";
let localAccessEnvPath = "";
if (!managedLinux && ["dev", "start"].includes(command)) {
  process.umask(0o077);
  await assertLocalServerPortAvailable({ port: Number(serverPort) });
  localDataStatePath = ensureLocalDataStatePath();
  const localAccessToken = rotateLocalAccessToken();
  localAccessEnvPath = ensureLocalAccessEnvFile(localAccessToken);
  if (command === "dev") process.env.BARO_PUBLISH_LOCAL_MODE = "1";
  if (process.stdout.isTTY) {
    process.stdout.write(`보안 시작 주소: ${createLocalBootstrapUrl({ token: localAccessToken, port: serverPort })}\n`);
  }
  const migration = spawnSync(process.execPath, [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    localDataStatePath,
    "--config",
    fileURLToPath(new URL("../wrangler.local.jsonc", import.meta.url)),
  ], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
    },
  });
  if (migration.error) throw migration.error;
  if (migration.status !== 0) {
    throw new Error("LOCAL_DATABASE_MIGRATION_FAILED: local data was not changed.");
  }
}

if (!managedLinux && command === "start") {
  await import("./sites-env.mjs");
  const wranglerCli = new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url);
  const child = spawn(process.execPath, [
    fileURLToPath(wranglerCli),
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--local",
    "--persist-to",
    localDataStatePath,
    "--env-file",
    localAccessEnvPath,
    "--ip",
    "127.0.0.1",
    "--port",
    serverPort,
    "--inspector-port",
    "0",
    ...args,
  ], { stdio: "inherit", env: process.env });
  const removeSignalForwarders = forwardSignalsTo(child);
  const status = await waitForChild(child);
  removeSignalForwarders();
  process.exitCode = status.code ?? 1;
} else {

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev"
    ? ["--host", "127.0.0.1", "--port", serverPort]
    : []), ...args];
await import(cli.href);
}
