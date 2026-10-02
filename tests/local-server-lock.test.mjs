import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLocalServerLock,
  forwardSignalToLockedCommand,
} from "../scripts/local-server-lock.mjs";

const localServerLockModuleUrl = new URL("../scripts/local-server-lock.mjs", import.meta.url).href;

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForFile(path) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Timed out waiting for locked command readiness.");
}

test("only one concurrent local startup can own the per-user process lock", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "baro-server-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = join(directory, "server.lock");
  const first = acquireLocalServerLock({
    lockPath,
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 300)"],
    env: process.env,
    stdio: "ignore",
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  const second = acquireLocalServerLock({
    lockPath,
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    env: process.env,
    stdio: "ignore",
  });

  const [firstStatus, secondStatus] = await Promise.all([waitForExit(first), waitForExit(second)]);
  assert.equal(firstStatus.code, 0);
  assert.equal(secondStatus.code, 75);
});

test("termination reaches the locked server while the lock remains held until it exits", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "baro-server-signal-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = join(directory, "server.lock");
  const markerPath = join(directory, "server-state.txt");
  const fixturePath = join(directory, "server-fixture.mjs");
  await writeFile(fixturePath, `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { registerLockedCommandProcess } from ${JSON.stringify(localServerLockModuleUrl)};
    writeFileSync(${JSON.stringify(markerPath)}, "ready\\n");
    process.once("SIGTERM", () => {
      setTimeout(() => {
        appendFileSync(${JSON.stringify(markerPath)}, "terminated\\n");
        process.exit(0);
      }, 200);
    });
    setTimeout(() => registerLockedCommandProcess(), 1_300);
    setTimeout(() => process.exit(2), 4_000);
    setInterval(() => {}, 1_000);
  `);
  const first = acquireLocalServerLock({
    lockPath,
    command: process.execPath,
    args: [fixturePath],
    env: process.env,
    stdio: "ignore",
  });
  await waitForFile(markerPath);

  assert.equal(await forwardSignalToLockedCommand(first, "SIGTERM"), true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const contender = acquireLocalServerLock({
    lockPath,
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    env: process.env,
    stdio: "ignore",
  });
  assert.equal((await waitForExit(contender)).code, 75);
  assert.equal((await waitForExit(first)).code, 0);
  assert.match(await readFile(markerPath, "utf8"), /terminated/);

  const afterExit = acquireLocalServerLock({
    lockPath,
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    env: process.env,
    stdio: "ignore",
  });
  assert.equal((await waitForExit(afterExit)).code, 0);
});
