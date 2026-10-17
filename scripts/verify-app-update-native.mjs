import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const app = "com.genzo.android.organizeqa", serial = "3B164M00Z0500000", port = 9359;
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = `D:/DevTools/Android/Build/qa/network-update-20261016/native-update-${Date.now()}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { app, output, cases: {} };
let browser, page, guarded = false;
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const native = command => invoke("android_native", { command, payload: {} });
const protectedHash = async () => createHash("sha256").update(JSON.stringify(await Promise.all([invoke("list_works"), invoke("get_video_source_states"), invoke("get_playback_progress")]))).digest("hex");
try {
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
  await delay(1800);
  const pid = command("shell", "pidof", app).trim();
  assert.match(pid, /^\d+$/);
  command("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost"));
  assert.ok(page);
  const info = await invoke("get_app_info");
  assert.equal(info.dataDirectory, `/data/user/0/${app}`);
  guarded = true;
  const before = await protectedHash();
  const initial = await native("appUpdateStatus");
  assert.equal(initial.currentVersion, "0.17.0");
  assert.equal(initial.phase, "idle");
  await page.evaluate(() => { location.hash = "#/diagnostics"; });
  await page.getByRole("heading", { name: "应用更新", exact: true }).waitFor();
  assert.equal((await native("appUpdateStatus")).phase, "idle", "About must not start a network check");
  const start = Date.now();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  let status;
  for (let attempt = 0; attempt < 30; attempt++) {
    status = await native("appUpdateStatus");
    if (status.phase !== "checking") break;
    await delay(1000);
  }
  assert.ok(["current", "available"].includes(status.phase), JSON.stringify(status));
  assert.equal(status.bytes, 0);
  result.cases.officialReleaseCheck = { phase: status.phase, currentVersion: status.currentVersion, version: status.version, milliseconds: Date.now() - start };
  assert.ok(command("shell", "dumpsys", "activity", "activities").split("\n").find(line => line.includes("topResumedActivity"))?.includes(app));
  writeFileSync(`${output}/about.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }));
  const comments = await invoke("get_bangumi_subject_comments", { externalId: "400602", offset: 0, limit: 2 });
  assert.ok(comments.items.length > 0);
  result.cases.publicBangumiComments = { count: comments.items.length, total: comments.total };
  assert.equal(await protectedHash(), before, "read-only update/comment checks preserve QA works, sources and progress");
  result.cases.personalRecordsPreserved = true;
  result.passed = true;
  console.log(JSON.stringify(result, null, 2));
} catch (error) { result.error = String(error); throw error; }
finally {
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  if (guarded && page) await native("cancelAppUpdate").catch(() => {});
  if (browser) await browser.close();
  command("forward", "--remove", `tcp:${port}`);
  if (guarded) command("shell", "am", "force-stop", app);
}
