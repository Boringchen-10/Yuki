import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve("dist"), output = "D:/DevTools/Android/Build/qa/onboarding-20261017";
const server = createServer((req, res) => {
  try { const path = req.url === "/" ? "/index.html" : req.url; res.setHeader("content-type", path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".png") ? "image/png" : "text/html; charset=utf-8"); res.end(readFileSync(root + path)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const result = { cases: [], errors: [], layouts: [] };
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "dark" });
  page.on("pageerror", error => result.errors.push(String(error)));
  await page.addInitScript(() => {
    window.__calls = []; window.__ruleMode = "auto"; window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (cmd, args) => {
      window.__calls.push(cmd);
      if (cmd === "android_native") return { top: 38, bottom: 24, left: 0, right: 0 };
      if (cmd === "get_rule_catalog") return { items: [], stale: false };
      if (cmd === "get_rules_network") return { mode: window.__ruleMode };
      if (cmd === "save_rules_network") { window.__ruleMode = args.config.mode; return args.config; }
      if (cmd === "probe_rules_network") return [{ source: "official", milliseconds: 20, error: null }];
      if (cmd === "get_reading_network") return { apiHost: "api.copy202601.com", appVersion: "3.0.9", route: 0, node: "", proxyMode: "system", proxyUrl: "", autoUpdate: true, comicConcurrency: 4, novelConcurrency: 2 };
      if (cmd === "get_bangumi_network") return { mode: "system", mirrorUrl: "" };
      if (cmd === "get_setting") return args?.key === "theme" ? localStorage.getItem("__dbTheme") : null;
      if (cmd === "set_setting" && args?.key === "theme") { localStorage.setItem("__dbTheme", args.value); return null; }
      if (cmd === "get_playback_progress") return { items: [], sessions: [] };
      if (cmd === "get_book_shelf_state") return {};
      if (cmd === "get_metadata_provider_statuses") return [];
      if (cmd === "plugin:event|listen") return 1;
      if (cmd.startsWith("list_") || ["get_video_source_states", "get_reading_history", "get_source_imports"].includes(cmd)) return [];
      return null;
    } };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/#/profile`);
  await page.getByRole("button", { name: "同意并继续", exact: true }).waitFor();
  assert.equal(await page.locator(".android-app").getAttribute("data-theme"), "light");
  assert.ok((await page.evaluate(() => window.__calls)).every(cmd => ["android_native", "set_android_appearance", "get_setting"].includes(cmd)));
  result.cases.push("production entry defaults blue-white and blocks main data before consent");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "同意并继续", exact: true }).click();
  const enter = page.getByRole("button", { name: "暂不添加，进入 Yuki", exact: true }); await enter.waitFor();
  assert.equal(await enter.evaluate(node => node.classList.contains("primary")), false);
  assert.ok(!(await page.evaluate(() => window.__calls)).includes("start_android_background_services"));
  await enter.click(); await page.getByRole("button", { name: "外观", exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.__calls)).includes("start_android_background_services"));
  assert.equal(await page.locator(".android-app").getAttribute("data-theme"), "light");
  assert.equal(await page.locator(".android-app").evaluate(node => getComputedStyle(node).getPropertyValue("--accent-h").trim()), "210");
  result.cases.push("completion mounts real blue-white profile and starts background services");
  for (const [width, height] of [[375, 812], [1280, 800]]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => { const prefs = JSON.parse(localStorage.getItem("genzo-preferences") || '{"state":{},"version":0}'); prefs.state.theme = theme; localStorage.setItem("genzo-preferences", JSON.stringify(prefs)); }, theme);
    await page.reload(); await page.getByRole("button", { name: "外观", exact: true }).waitFor();
    assert.equal(await page.locator(".android-app").getAttribute("data-theme"), theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({ path: `${output}/bluewhite-profile-${width}-${theme}.png`, animations: "disabled" });
    result.layouts.push({ width, height, theme });
  }
  await page.getByRole("button", { name: "使用协议与隐私说明", exact: true }).click();
  await page.getByRole("heading", { name: "使用协议与隐私说明", exact: true }).waitFor();
  await page.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("combobox", { name: "主题模式" }).selectOption("system");
  await page.getByRole("combobox", { name: "主题模式" }).selectOption("dark");
  await page.reload(); await page.getByRole("button", { name: "恢复默认外观", exact: true }).waitFor();
  assert.equal(await page.locator(".android-app").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "恢复默认外观", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".android-app").dataset.theme === "light");
  await page.reload(); await page.getByRole("button", { name: "恢复默认外观", exact: true }).waitFor();
  assert.equal(await page.locator(".android-app").getAttribute("data-theme"), "light");
  result.cases.push("real appearance selector persists DB mode; reset restores light mode across restart");
  await page.evaluate(() => location.hash = "#/network");
  const ruleNetwork = page.getByRole("region", { name: "规则仓库连接", exact: true });
  await ruleNetwork.getByRole("combobox", { name: "规则连接方式" }).selectOption("direct");
  await ruleNetwork.getByText("已保存：官方直连", { exact: true }).waitFor();
  await ruleNetwork.getByRole("button", { name: "测试规则连接" }).click();
  await ruleNetwork.getByText("官方仓库：20 ms · 可用", { exact: true }).waitFor();
  result.cases.push("real network settings expose rule transport independently of Bangumi and COPY");
  await page.evaluate(() => { localStorage.removeItem("genzo-preferences"); localStorage.removeItem("yuki-android-onboarding"); localStorage.setItem("__dbTheme", "dark"); });
  await page.reload(); await page.getByRole("button", { name: "同意并继续", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".android-app").dataset.theme === "dark");
  result.cases.push("legacy database theme is honored before agreement without media/network startup");
  assert.deepEqual(result.errors, []); result.passed = true;
  console.log(JSON.stringify(result));
} catch (error) { result.error = String(error); throw error; }
finally { writeFileSync(`${output}/bluewhite-production-entry.json`, JSON.stringify(result, null, 2)); await browser.close(); server.close(); }
