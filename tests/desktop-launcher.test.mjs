import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const launcherUrl = new URL("../scripts/desktop-launcher.zsh", import.meta.url);
const autostartUrl = new URL("../scripts/com.local.naver-blog-finalizer.autostart.plist", import.meta.url);
const portUrl = new URL("../scripts/server-port", import.meta.url);
const frameworkRunnerUrl = new URL("../scripts/run-framework.mjs", import.meta.url);
const viteConfigUrl = new URL("../vite.config.ts", import.meta.url);
const installerUrl = new URL("../scripts/install-macos-autostart.zsh", import.meta.url);
const runtimeEntitlementsUrl = new URL("../scripts/node-runtime-entitlements.plist", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("desktop launcher checks the dedicated static health marker", async () => {
  const launcher = await readFile(launcherUrl, "utf8");
  const readinessFunction = launcher.match(/site_is_ready\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(readinessFunction, /baro-health\.txt/);
  assert.match(readinessFunction, /grep --fixed-strings --line-regexp/);
  assert.match(readinessFunction, /--write-out '%\{http_code\}'/);
  assert.match(readinessFunction, /root_status.*== "200"/s);
  assert.match(launcher, /listener_is_ours/);
});

test("desktop launcher and framework runner share a dedicated non-default port", async () => {
  const [launcher, frameworkRunner, viteConfig, portText] = await Promise.all([
    readFile(launcherUrl, "utf8"),
    readFile(frameworkRunnerUrl, "utf8"),
    readFile(viteConfigUrl, "utf8"),
    readFile(portUrl, "utf8"),
  ]);
  const port = Number(portText.trim());

  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  assert.notEqual(port, 5173);
  assert.match(launcher, /scripts\/server-port/);
  assert.match(frameworkRunner, /server-port/);
  assert.match(frameworkRunner, /--host/);
  assert.doesNotMatch(frameworkRunner, /\? \["--hostname"/);
  assert.match(frameworkRunner, /LOCAL_SERVER_OPTION_OVERRIDE/);
  assert.match(viteConfig, /strictPort:\s*!managedLinux/);
});

test("local startup migrates and persists D1 in the macOS user data directory", async () => {
  const [frameworkRunner, viteConfig, packageJson] = await Promise.all([
    readFile(frameworkRunnerUrl, "utf8"),
    readFile(viteConfigUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);

  assert.match(frameworkRunner, /ensureLocalDataStatePath/);
  assert.match(frameworkRunner, /"d1",\s*\n\s*"migrations",\s*\n\s*"apply"/);
  assert.match(frameworkRunner, /"--persist-to",\s*\n\s*localDataStatePath/);
  assert.match(frameworkRunner, /ensureLocalAccessEnvFile/);
  assert.match(frameworkRunner, /rotateLocalAccessToken/);
  assert.match(frameworkRunner, /createLocalBootstrapUrl/);
  assert.doesNotMatch(frameworkRunner, /process\.env\.BARO_PUBLISH_LOCAL_TOKEN\s*=/);
  assert.match(frameworkRunner, /"--env-file",\s*\n\s*localAccessEnvPath/);
  assert.match(frameworkRunner, /spawn\(process\.execPath/);
  assert.match(frameworkRunner, /SIGTERM/);
  assert.match(frameworkRunner, /LOCAL_DATABASE_MIGRATION_FAILED/);
  assert.match(viteConfig, /binding:\s*"DB"/);
  assert.match(viteConfig, /persistState:\s*managedLinux\s*\?\s*true\s*:\s*\{ path: getLocalDataStatePath\(\) \}/);
  assert.match(packageJson, /"start":\s*"node scripts\/run-framework\.mjs start"/);
});

test("direct local startup checks the fixed port before rotating its access token", async () => {
  const frameworkRunner = await readFile(frameworkRunnerUrl, "utf8");
  const portCheckIndex = frameworkRunner.indexOf("await assertLocalServerPortAvailable");
  const tokenRotationIndex = frameworkRunner.indexOf("rotateLocalAccessToken()");

  assert.ok(portCheckIndex >= 0, "the local port must be checked before startup");
  assert.ok(tokenRotationIndex >= 0, "the access token must still rotate on a real startup");
  assert.ok(portCheckIndex < tokenRotationIndex, "a duplicate start must not invalidate the running server token");
});

test("direct local startup takes a per-user lock before checking the port or rotating the token", async () => {
  const frameworkRunner = await readFile(frameworkRunnerUrl, "utf8");
  const lockIndex = frameworkRunner.indexOf("const lockedChild = acquireLocalServerLock");
  const portCheckIndex = frameworkRunner.indexOf("await assertLocalServerPortAvailable");
  const tokenRotationIndex = frameworkRunner.indexOf("rotateLocalAccessToken()");

  assert.ok(lockIndex >= 0, "direct startup must acquire a process lock");
  assert.ok(lockIndex < portCheckIndex, "the process lock must cover the port probe");
  assert.ok(lockIndex < tokenRotationIndex, "the process lock must cover token rotation");
  assert.match(frameworkRunner, /locked-runner\.mjs/);
});

test("desktop launcher creates a private capability and opens it only in a URL fragment", async () => {
  const launcher = await readFile(launcherUrl, "utf8");

  assert.match(launcher, /access_token_path/);
  assert.match(launcher, /openssl rand -hex 32/);
  assert.match(launcher, /chmod 400/);
  assert.match(launcher, /#baro-token=/);
  assert.match(launcher, /prepare_access_token.*open_site/s);
  assert.doesNotMatch(launcher, /\?baro-token=/);
});

test("desktop launcher supports quiet background startup", async () => {
  const launcher = await readFile(launcherUrl, "utf8");

  assert.match(launcher, /--background/);
  assert.match(launcher, /background_mode/);
  assert.match(launcher, /private_paths_ready/);
  assert.match(launcher, /chmod 600 "\$\{launcher_log_path\}"/);
  assert.match(launcher, /runtime_dir=.*\/runtime/);
  assert.match(launcher, /runtime_manifest_path/);
  assert.match(launcher, /load_runtime_manifest/);
  assert.match(launcher, /stat -f '%u'/);
  assert.match(launcher, /codesign --verify --strict/);
  assert.match(launcher, /expected_cdhash/);
  assert.match(launcher, /otool -L/);
  assert.match(launcher, /cd "\$1" && exec "\$2" "\$3" dev/);
  assert.doesNotMatch(launcher, /command -v npm/);
  assert.doesNotMatch(launcher, /site_is_ready\n\}/);
});

test("macOS autostart agent launches the service once the user logs in", async () => {
  const plist = await readFile(autostartUrl, "utf8");

  assert.match(plist, /<string>com\.local\.naver-blog-finalizer\.autostart<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<string>--background<\/string>/);
  assert.doesNotMatch(plist, /Standard(?:Out|Error)Path/);
});

test("macOS installer copies a private runtime before registering autostart", async () => {
  const [installer, runtimeEntitlements] = await Promise.all([
    readFile(installerUrl, "utf8"),
    readFile(runtimeEntitlementsUrl, "utf8"),
  ]);

  assert.match(installer, /install -m 500/);
  assert.match(installer, /ChatGPT\.app\/Contents\/Resources\/cua_node\/bin\/node/);
  assert.match(installer, /codesign --verify --strict/);
  assert.match(installer, /--test-requirement/);
  assert.match(installer, /anchor apple generic/);
  assert.match(installer, /TeamIdentifier=2DC432GLL2/);
  assert.match(installer, /otool -L/);
  assert.match(installer, /codesign --force --sign - --options runtime/);
  assert.match(installer, /node-runtime-entitlements\.plist/);
  assert.match(installer, /runtime_manifest_path/);
  assert.match(installer, /mktemp.*runtime_dir/s);
  assert.match(installer, /lockf -k -t/);
  assert.match(installer, /chmod 400.*manifest/s);
  assert.match(installer, /trap cleanup_install_files EXIT/);
  assert.match(installer, /trap 'exit 129' HUP/);
  assert.match(installer, /trap 'exit 130' INT/);
  assert.match(installer, /trap 'exit 143' TERM/);
  assert.doesNotMatch(installer, /version_ok="\$\("\$\{source_node\}"/);
  assert.match(runtimeEntitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(runtimeEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(runtimeEntitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.match(installer, /runtime_dir=.*\/runtime/);
  assert.match(installer, /runtime_target=.*runtime_dir/s);
  assert.match(installer, /install -m 755.*desktop-launcher\.zsh/s);
  assert.match(installer, /agent_source=.*autostart\.plist/);
  assert.match(installer, /install -m 600.*agent_source/s);
  assert.match(installer, /launchctl bootstrap/);
});

test("desktop launcher pins the locally signed runtime code hash", async () => {
  const launcher = await readFile(launcherUrl, "utf8");

  assert.match(launcher, /runtime_manifest_path/);
  assert.match(launcher, /codesign -dv --verbose=4/);
  assert.match(launcher, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(launcher, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(launcher, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.match(launcher, /plutil -extract/);
  assert.match(launcher, /entry_count.*== "3"/s);
  assert.match(launcher, /dylib_listing=.*otool -L/s);
});

test("runtime entitlements contain exactly the three required true permissions", async () => {
  const runtimeEntitlements = await readFile(runtimeEntitlementsUrl, "utf8");
  const keys = [...runtimeEntitlements.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map(
    ([, key]) => key,
  );

  assert.deepEqual(keys.sort(), [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
  ]);
  assert.doesNotMatch(runtimeEntitlements, /<false\/>/);
});
