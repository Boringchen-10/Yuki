import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { build } from "vite";
import { chromium } from "playwright-core";

const output = `D:/DevTools/Android/Build/qa/episode-match-ui-${Date.now()}`; mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/android-episode-match.tsx", name: "EpisodeMatchFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); const errors = []; page.on("pageerror", error => errors.push(String(error)));
const result = { output, cases: {}, layouts: [] };
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/yuki.css`, "utf8") }); await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.getByLabel("文件起始集号", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /预览匹配/ }).isDisabled(), true);
  await page.getByLabel("文件起始集号", { exact: true }).fill("13");
  await page.getByRole("button", { name: "预览匹配（12 个）", exact: true }).waitFor();
  await page.getByText("文件第 24 集 → 官方第 12 集 · 官方第12集", { exact: true }).waitFor(); result.cases.explicitNumberCorrespondence = true;
  const other = page.locator("label.gz-file-choice").filter({ hasText: "[另一版本]" }).getByRole("checkbox"); await other.uncheck();
  await page.getByRole("button", { name: "预览匹配（11 个）", exact: true }).click();
  const preview = await page.evaluate(() => window.__qaCalls.findLast(call => call.type === "preview"));
  assert.equal(preview.input.episodeOffset, 12); assert.equal(preview.input.targetWorkId, "w"); assert.equal(preview.input.sourceWorkId, "w"); assert.equal(preview.input.mediaFileIds.length, 11);
  assert.ok(!preview.input.mediaFileIds.includes("f1") && !preview.input.mediaFileIds.includes("f12") && !preview.input.mediaFileIds.includes("f13"));
  assert.equal(await page.getByRole("button", { name: "确认批量匹配", exact: true }).isDisabled(), true); result.cases.selectionAndExistingLinksProtected = true;
  await page.getByLabel("文件起始集号", { exact: true }).fill("14"); await page.locator('[aria-label="批量剧集匹配预览"]').waitFor({ state: "detached" }); result.cases.changedOffsetInvalidatesPreview = true;
  await page.getByLabel("文件起始集号", { exact: true }).fill("13"); await page.getByRole("button", { name: "预览匹配（12 个）", exact: true }).click();
  await page.getByRole("checkbox", { name: "已核对文件与官方分集的逐行对应", exact: true }).check(); await page.getByRole("button", { name: "确认批量匹配", exact: true }).click();
  await page.locator("[data-qa-saved]").filter({ hasText: "saved" }).waitFor();
  assert.equal((await page.evaluate(() => window.__qaCalls.findLast(call => call.type === "apply"))).input.episodeOffset, 12); result.cases.previewAndConfirm = true;
  await page.getByRole("checkbox", { name: "显示已关联文件，供重新核对", exact: true }).check();
  const manual = page.locator("label.gz-file-choice").filter({ hasText: "作品第二季 - 14.mkv" }).getByRole("checkbox"); assert.equal(await manual.isChecked(), false);
  result.cases.manualMappingNotAutomaticallySelected = true;
  for (const width of [360, 412, 915, 1024]) {
    await page.setViewportSize({ width, height: width > 700 ? 640 : 915 });
    for (const theme of ["dark", "light"]) {
      await page.locator(".android-app").evaluate((node, theme) => node.dataset.theme = theme, theme);
      await page.locator(".gz-scroll").evaluate(node => node.scrollTop = 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.screenshot({ path: `${output}/matching-${width}-${theme}.png` }); result.layouts.push({ width, theme });
    }
  }
  assert.deepEqual(errors, []); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, passed: true }));
} catch (error) { result.error = String(error); await page.screenshot({ path: `${output}/failure.png` }); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error; }
finally { await browser.close(); }
