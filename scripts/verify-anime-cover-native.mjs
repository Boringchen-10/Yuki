import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const app = "com.genzo.android.organizeqa", serial = "3B164M00Z0500000", port = 9360;
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const missing = process.argv.includes("--expect-missing"), marker = `GenzoCoverQA-${Date.now()}`;
const output = `D:/DevTools/Android/Build/qa/blue-box-cover-20261017/native-${Date.now()}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, ownedId, before, guarded = false;
const result = { app, output, expectMissing: missing };
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const records = async () => createHash("sha256").update(JSON.stringify(await invoke("list_works"))).digest("hex");
async function connect() {
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
  await delay(1600);
  const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
  command("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true }); break; }
    catch (error) { if (attempt === 4) throw error; await delay(500); }
  }
  page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost")); assert.ok(page);
}
try {
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
  await delay(1600);
  const pid = command("shell", "pidof", app).trim();
  assert.match(pid, /^\d+$/);
  command("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true }); break; }
    catch (error) { if (attempt === 4) throw error; await delay(500); }
  }
  page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost"));
  assert.ok(page);
  const info = await invoke("get_app_info");
  assert.equal(info.dataDirectory, `/data/user/0/${app}`);
  assert.equal((await invoke("sync_status")).connected, false);
  guarded = true;
  before = await records();
  // Seed only this guarded QA profile so the regression is independent of API availability.
  assert.equal(info.databasePath, `/data/user/0/${app}/genzo.db`);
  command("shell", "am", "force-stop", app); await browser.close(); browser = null;
  for (const suffix of ["", "-wal"]) {
    try { writeFileSync(`${output}/qa-genzo.db${suffix}`, execFileSync(adb, ["-s", serial, "exec-out", "run-as", app, "cat", `${info.databasePath}${suffix}`], { timeout: 20000, maxBuffer: 48 * 1024 * 1024 })); }
    catch (error) { if (!suffix || !String(error.stderr).includes("No such file")) throw error; }
  }
  const seeded = JSON.parse(execFileSync("C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe", ["scripts/fixtures/android-cover-seed.py", `${output}/qa-genzo.db`, "D:/DevTools/Android/Build/qa/blue-box-cover-20261017/public-subject.json", marker], { encoding: "utf8" }));
  const staged = `/data/local/tmp/${marker}.db`, photo = `/data/local/tmp/${marker}.jpg`;
  command("push", seeded.database, staged);
  command("shell", "run-as", app, "rm", "-f", `${info.databasePath}-wal`, `${info.databasePath}-shm`);
  command("shell", "run-as", app, "cp", staged, info.databasePath); command("shell", "rm", staged);
  ownedId = seeded.workId;
  const hash = createHash("sha256").update(`bangumi:548156:cover:${seeded.coverUrl}`).digest("hex").slice(0, 24);
  command("push", "D:/DevTools/Android/Build/qa/blue-box-cover-20261017/public-cover.jpg", photo);
  for (const suffix of ["", "-thumb"]) command("shell", "run-as", app, "cp", photo, `${info.coverCachePath}/art-v2-${hash}-cover${suffix}.jpg`);
  command("shell", "rm", photo);
  await connect();
  const thumbnail = await invoke("cache_anime_explore_cover", { externalId: "548156", coverUrl: seeded.coverUrl });
  const natural = await page.evaluate(path => new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(Error("QA discovery cache did not load"));
    image.src = window.__TAURI_INTERNALS__.convertFileSrc(path, "asset");
  }), thumbnail);
  assert.ok(natural.width > 0 && natural.height > 0);
  const recovered = await invoke("get_work", { id: ownedId });
  assert.equal(recovered.coverPath, null, "cache recovery must not change the saved cover field");
  assert.equal(recovered.notes, marker); assert.equal(recovered.favorite, true); assert.equal(recovered.rating, 9);
  assert.equal(!!recovered.coverFallbackPath, !missing);
  await page.evaluate(id => { location.hash = `#/detail/${encodeURIComponent(id)}`; }, ownedId);
  await page.locator(".gz-subject-body .gz-poster").waitFor();
  if (missing) {
    await page.locator(".gz-subject-body .gz-poster").getByText("暂无封面", { exact: true }).waitFor();
    assert.equal(await page.locator(".gz-subject-body .gz-poster img").count(), 0);
  } else {
    await page.waitForFunction(() => document.querySelector(".gz-subject-body .gz-poster img")?.naturalWidth > 0);
    assert.equal(await page.locator(".gz-subject-backdrop img").count(), 1);
  }
  assert.ok(command("shell", "dumpsys", "activity", "activities").split("\n").find(line => line.includes("topResumedActivity"))?.includes(app));
  writeFileSync(`${output}/detail.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }));
  result.discoveryImage = natural; result.detailHasRecoveredCover = !!recovered.coverFallbackPath; result.version = info.version; result.passed = true;
} catch (error) { result.error = String(error); throw error; }
finally {
  if (guarded && ownedId) {
    const work = await invoke("get_work", { id: ownedId });
    assert.equal(work.metadata?.externalId, "548156");
    assert.ok(work.notes === marker || !work.notes, "only remove this test's own generated work");
    await invoke("delete_work", { id: ownedId });
    assert.equal(await records(), before);
    result.recordsRestored = true;
  }
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  command("forward", "--remove", `tcp:${port}`);
  if (guarded) command("shell", "am", "force-stop", app);
  console.log(JSON.stringify(result, null, 2));
}
