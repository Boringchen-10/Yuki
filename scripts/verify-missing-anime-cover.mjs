import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = `D:/DevTools/Android/Build/qa/blue-box-cover-20261017/browser-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"', __GENZO_ANDROID__: "true" }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/missing-anime-cover.tsx", name: "MissingCoverFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce" });
const errors = [], cases = [];
page.on("pageerror", error => errors.push(String(error)));
const loaded = async () => {
  await page.locator(".gz-subject-body .gz-poster img").waitFor({ timeout: 4000 });
  await page.waitForFunction(() => document.querySelector(".gz-subject-body .gz-poster img")?.naturalWidth > 0, null, { timeout: 4000 });
};
try {
  await page.route("http://cover.test/**", route => route.fulfill({ status: 404, body: "missing" }));
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.locator(".gz-cover img").first().waitFor();
  await page.getByText("青之箱 第二季", { exact: true }).click();
  await page.waitForFunction(() => location.hash === "#/detail/blue-box");
  await loaded();
  assert.equal(await page.locator(".gz-subject-body .gz-poster img").getAttribute("src"), await page.evaluate(() => window.__coverPoster));
  cases.push("saved discovery detail reuses its cached cover despite a missing saved cover path");
  for (const mode of ["missing", "broken", "manual"]) {
    await page.evaluate(mode => window.__coverMode(mode), mode);
    await page.waitForFunction(() => location.hash === "#/library");
    await page.evaluate(() => { location.hash = "#/detail/blue-box"; });
    await loaded();
    assert.equal(await page.locator(".gz-subject-body .gz-poster img").getAttribute("src"), await page.evaluate(mode => mode === "manual" ? window.__coverOriginal : window.__coverPoster, mode));
    assert.equal(await page.locator(".gz-subject-backdrop img").count(), 1);
    cases.push(`${mode}: library detail and backdrop use the correct cover`);
  }
  for (const width of [360, 412, 915, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 915 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.screenshot({ path: `${output}/detail.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, cases, errors }, null, 2));
  console.log(JSON.stringify({ output, cases, passed: true }));
} catch (error) { await page.screenshot({ path: `${output}/failure.png` }); throw error; }
finally { await browser.close(); }
