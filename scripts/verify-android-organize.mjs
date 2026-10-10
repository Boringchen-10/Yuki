import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { build } from "vite";
import { chromium } from "playwright-core";

const output = `D:/DevTools/Android/Build/qa/organize-ui-${Date.now()}`; mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/android-organize.tsx", name: "OrganizeFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = []; page.on("pageerror", error => errors.push(String(error)));
const result = { output, cases: {}, layouts: [] };
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/genzo.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.getByRole("button", { name: /测试网盘/ }).click();
  await page.getByRole("button", { name: /动画/ }).click(); await page.getByRole("button", { name: /2024/ }).click();
  await page.getByRole("button", { name: /作品甲.*1 组/ }).waitFor();
  await page.getByRole("button", { name: /自动识别此目录/ }).click();
  await page.getByRole("button", { name: "读取测试调用", exact: true }).click();
  const queued = (await page.evaluate(() => window.__qaCalls)).find(call => call.type === "enqueue");
  assert.deepEqual(queued.sourceIds, ["dav"]); assert.equal(queued.scan, false); assert.deepEqual(queued.mediaIds, ["a", "pending"]);
  await page.getByRole("button", { name: "逐个整理此目录", exact: true }).click();
  assert.equal(await page.locator("[data-qa-opened]").innerText(), "a:1"); result.cases.directoryAndContinuous = true;
  await page.getByRole("button", { name: "organize", exact: true }).click();
  await page.getByText("动画/作品甲", { exact: false }).waitFor();
  await page.getByRole("checkbox").nth(1).uncheck();
  await page.getByRole("button", { name: "查找候选", exact: true }).click();
  await page.getByRole("button", { name: "预览关联", exact: true }).click();
  await page.getByRole("button", { name: "确认关联", exact: true }).click();
  await page.getByRole("button", { name: "读取测试调用", exact: true }).click();
  const calls = await page.evaluate(() => window.__qaCalls);
  const confirmed = calls.find(call => call.type === "confirm"); assert.equal(confirmed.id, "b"); assert.deepEqual(confirmed.selected, ["sub", "b"]);
  result.cases.videoRepresentativeAndPreview = true;
  await page.getByText("资料类型", { exact: false }).locator("select").selectOption("movie");
  assert.equal(await page.getByRole("checkbox").nth(0).isChecked(), false);
  assert.equal(await page.getByRole("checkbox").nth(1).isChecked(), true);
  assert.equal(await page.getByRole("checkbox").nth(2).isChecked(), false); result.cases.movieSelection = true;
  await page.getByRole("button", { name: "episodes", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /播放 第 1 集/ }).count(), 1);
  await page.getByRole("combobox", { name: "第 1 集的播放文件" }).selectOption("b");
  await page.getByRole("button", { name: /播放 第 1 集/ }).click();
  await page.getByRole("button", { name: "读取测试调用", exact: true }).click();
  assert.equal((await page.evaluate(() => window.__qaCalls)).findLast(call => call.type === "play").id, "b");
  await page.getByRole("button", { name: "WebDAV", exact: true }).click(); assert.equal(await page.getByRole("combobox").count(), 0);
  await page.getByRole("button", { name: /播放 第 1 集/ }).click();
  await page.getByRole("button", { name: "读取测试调用", exact: true }).click();
  assert.equal((await page.evaluate(() => window.__qaCalls)).findLast(call => call.type === "play").id, "a"); result.cases.officialEpisodeSources = true;
  await page.getByAltText("分集剧照").waitFor(); await page.waitForFunction(() => document.querySelector("img.gz-episode-still")?.naturalWidth > 0);
  await page.getByRole("button", { name: "读取测试调用", exact: true }).click();
  assert.ok((await page.evaluate(() => window.__qaCalls)).some(call => call.type === "cache" && call.episodeKey === "bangumi:ep1")); result.cases.episodeStillAndVisibleCache = true;
  await page.getByRole("button", { name: "全部来源", exact: true }).click();
  for (const width of [360, 412, 915, 1024]) {
    await page.setViewportSize({ width, height: width > 700 ? 640 : 915 });
    for (const theme of ["dark", "light"]) {
      await page.locator(".android-app").evaluate((node, theme) => node.dataset.theme = theme, theme);
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.screenshot({ path: `${output}/episodes-${width}-${theme}.png` }); result.layouts.push({ width, theme });
      await page.getByRole("button", { name: "tasks", exact: true }).click();
      await page.getByRole("button", { name: "查看后台整理任务", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const dialogWidth = await page.locator("dialog").evaluate(node => ({ inner: node.clientWidth, full: node.scrollWidth })); assert.equal(dialogWidth.inner, dialogWidth.full);
      await page.screenshot({ path: `${output}/tasks-${width}-${theme}.png` });
      await page.getByRole("button", { name: "关闭后台整理", exact: true }).click(); await page.getByRole("button", { name: "episodes", exact: true }).click();
    }
  }
  assert.deepEqual(errors, []); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, passed: true }));
} catch (error) { result.error = String(error); await page.screenshot({ path: `${output}/failure.png` }); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error; }
finally { await browser.close(); }
