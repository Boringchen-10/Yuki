import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const app = "com.genzo.android.iconqa";
const serial = process.env.GENZO_ANDROID_SERIAL;
assert.ok(serial, "Set the exact QA device serial");
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = `D:/DevTools/Android/Build/qa/app-icons-20261017/native-${Date.now()}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 30000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page;
const result = { app, serial, output, cases: [] };
const native = (command, payload = {}) => page.evaluate(({ command, payload }) => window.__TAURI_INTERNALS__.invoke("android_native", { command, payload }), { command, payload });
const launcher = () => command("shell", "cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-p", app);
const startLauncher = () => {
  const component = launcher().split(/\s+/).find(value => value.startsWith(`${app}/`));
  assert.ok(component, "An enabled QA launcher must resolve");
  command("shell", "am", "start", "-W", "-n", component);
};
async function connect() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pid = command("shell", "pidof", app).trim().split(/\s+/)[0];
    if (pid && command("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) {
      command("forward", "tcp:9368", `localabstract:webview_devtools_remote_${pid}`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:9368", { noDefaults: true });
      page = browser.contexts()[0].pages().find(item => item.url().includes("tauri.localhost"));
      if (page) { await page.waitForFunction(() => !!window.__TAURI_INTERNALS__); return; }
      await browser.close();
    }
    await delay(250);
  }
  throw new Error("Isolated QA WebView not ready");
}
async function general() {
  await page.evaluate(() => { location.hash = "#/general"; });
  await page.getByRole("radiogroup", { name: "应用图标", exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.gz-app-icon')].some(node => node.getAttribute("aria-checked") === "true"));
  await page.waitForFunction(() => [...document.querySelectorAll('.gz-app-icon img')].length === 3 && [...document.querySelectorAll('.gz-app-icon img')].every(image => image.complete && image.naturalWidth === 256));
}
function screenshot(name) {
  const resumed = command("shell", "dumpsys", "activity", "activities").split("\n").filter(line => /topResumedActivity=|mResumedActivity:/.test(line));
  assert.ok(resumed.some(line => line.includes(`${app}/com.genzo.android.MainActivity`)), "Only capture the foreground QA package");
  writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
}
try {
  assert.match(command("shell", "pm", "path", app), /package:/);
  command("shell", "input", "keyevent", "224");
  command("shell", "am", "start", "-W", "-n", `${app}/com.genzo.android.MainActivity`);
  await connect(); await general();
  const original = await native("getAppIcon"); result.original = original.id;
  for (const [id, label, suffix] of [["classic", "经典校服", "Classic"], ["beret", "贝雷帽约会", "Beret"], ["winter", "围巾冬装", "Winter"]]) {
    await page.getByRole("radio", { name: new RegExp(label) }).click();
    await page.waitForFunction(label => [...document.querySelectorAll('.gz-app-icon')].some(node => node.textContent.includes(label) && node.getAttribute("aria-checked") === "true"), label);
    assert.equal((await native("getAppIcon")).id, id);
    assert.match(launcher(), new RegExp(`Launcher${suffix}`));
    screenshot(id); result.cases.push(`real UI switches ${id} launcher`);
  }
  const invalid = await native("setAppIcon", { id: "unknown" }).then(() => false, () => true);
  assert.equal(invalid, true); assert.equal((await native("getAppIcon")).id, "winter"); result.cases.push("native invalid id rejected without mutation");
  await browser.close(); browser = null;
  command("shell", "am", "force-stop", app);
  startLauncher();
  await connect(); await general();
  assert.equal((await native("getAppIcon")).id, "winter"); result.cases.push("selected launcher starts app after force stop");
  if (process.env.GENZO_ICON_QA_APK) {
    const apk = process.env.GENZO_ICON_QA_APK;
    const badging = execFileSync("D:/DevTools/Android/Sdk/build-tools/35.0.0/aapt.exe", ["dump", "badging", apk], { encoding: "utf8" });
    assert.match(badging.split("\n")[0], /name='com\.genzo\.android\.iconqa'/);
    await browser.close(); browser = null;
    command("install", "--no-streaming", "-r", apk);
    assert.match(launcher(), /LauncherWinter/);
    startLauncher();
    await connect(); await general(); assert.equal((await native("getAppIcon")).id, "winter");
    result.cases.push("same-package reinstall retains selected icon");
  }
  await native("setAppIcon", { id: original.id });
  assert.equal((await native("getAppIcon")).id, original.id);
  result.passed = true;
} catch (error) { result.error = String(error); throw error; }
finally {
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  command("forward", "--remove", "tcp:9368");
  command("shell", "am", "force-stop", app);
}
console.log(JSON.stringify(result));
