import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { registerLockedCommandProcess } from "./local-server-lock.mjs";

const [runnerPath, ...runnerArguments] = process.argv.slice(2);
if (!runnerPath || !isAbsolute(runnerPath)) {
  throw new Error("Expected an absolute locked runner path.");
}

registerLockedCommandProcess();
process.argv = [process.execPath, runnerPath, ...runnerArguments];
await import(pathToFileURL(runnerPath).href);
