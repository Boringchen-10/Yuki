import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const app = "com.genzo.android.rulesqa", serial = process.env.GENZO_ANDROID_SERIAL;
assert.ok(serial, "Set the exact QA device serial");
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = `D:/DevTools/Android/Build/qa/rules-update-20261017/native-${Date.now()}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 30000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page;
const result = { output, app, cases: [] };
try {
  command("shell", "am", "start", "-W", "-n", `${app}/com.genzo.android.MainActivity`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const pid = command("shell", "pidof", app).trim().split(/\s+/)[0];
    if (pid && command("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) {
      command("forward", "tcp:9390", `localabstract:webview_devtools_remote_${pid}`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:9390", { noDefaults: true });
      page = browser.contexts()[0].pages().find(item => item.url().includes("tauri.localhost"));
      if (page) break;
      await browser.close();
    }
    await delay(250);
  }
  assert.ok(page);
  const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
  const info = await invoke("get_app_info"); assert.equal(info.dataDirectory, `/data/user/0/${app}`);
  assert.deepEqual(await invoke("list_works"), []);
  const response = await fetch("https://raw.githubusercontent.com/Predidit/KazumiRules/main/LMM.json", { signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok);
  const upstream = await response.json();
  assert.equal(upstream.api, "9");
  const old = { ...upstream, api: "8", version: "qa-before-update" };
  const id = await invoke("import_rule_plugin", { definition: old, origin: "https://raw.githubusercontent.com/Predidit/KazumiRules/main/LMM.json" });
  await invoke("set_rule_plugin_enabled", { id, enabled: false, remove: false });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: /规则设置/ }).click();
  await page.getByRole("button", { name: "规则仓库", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "规则仓库", exact: true });
  const row = dialog.locator("article").filter({ has: page.getByText("LMM", { exact: true }) });
  await row.getByRole("button", { name: "更新", exact: true }).click();
  await row.getByRole("button", { name: "重新获取", exact: true }).waitFor({ timeout: 30000 });
  const plugins = await invoke("list_rule_plugins"), plugin = plugins.find(plugin => plugin.id === id);
  assert.equal(plugin.version, upstream.version); assert.equal(plugin.enabled, false);
  assert.equal((await invoke("get_rule_definition", { id })).api, "9");
  result.cases.push("actual catalog UI upgrades API8 to upstream API9 with stable id and disabled state");
  const good = await invoke("get_rule_definition", { id });
  await assert.rejects(() => invoke("import_rule_plugin", { definition: { ...good, api: "99" }, origin: plugin.origin }));
  assert.deepEqual(await invoke("get_rule_definition", { id }), good);
  result.cases.push("unsupported future API preserves the installed definition");
  const catalog = await invoke("get_rule_catalog", { fresh: true });
  for (const entry of catalog.items) {
    const installed = await invoke("install_catalog_rule", { name: entry.name });
    const definition = await invoke("get_rule_definition", { id: installed });
    assert.ok(Number(definition.api || 1) <= 9);
  }
  assert.deepEqual(await invoke("list_works"), []);
  result.cases.push(`all ${catalog.items.length} current catalog definitions install without creating works`);
  // Native audit calls bypass React; remount before checking the final UI counts.
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: /规则设置/ }).click();
  await page.getByRole("button", { name: "规则仓库", exact: true }).click();
  await dialog.getByRole("button", { name: `已安装 ${catalog.items.length}`, exact: true }).waitFor();
  await dialog.locator(".gz-rule-catalog").evaluate(node => node.scrollTop = node.scrollHeight);
  const safe = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0);
  const header = await dialog.locator("header").boundingBox(); assert.ok(header.y >= safe);
  const last = await dialog.locator("article").last().boundingBox();
  assert.ok(last.y + last.height <= await page.evaluate(() => innerHeight));
  const resumed = command("shell", "dumpsys", "activity", "activities").split("\n").filter(line => /topResumedActivity=|mResumedActivity:/.test(line));
  assert.ok(resumed.some(line => line.includes(`${app}/com.genzo.android.MainActivity`)));
  writeFileSync(`${output}/catalog.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  result.cases.push("real status-bar inset and last catalog row remain reachable");
  result.catalogCount = catalog.items.length; result.passed = true;
} catch (error) { result.error = String(error); throw error; }
finally {
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  command("forward", "--remove", "tcp:9390");
  command("shell", "am", "force-stop", app);
}
console.log(JSON.stringify(result));
