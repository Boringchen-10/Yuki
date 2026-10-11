import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const output = `D:/DevTools/Android/Build/qa/home-player-ui-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/android-home-player-settings.tsx", name: "HomePlayerFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const result = { output, cases: {}, layouts: [] }, errors = [];
page.on("pageerror", error => errors.push(String(error)));
const setPage = value => page.evaluate(value => window.__qaPage(value), value);
const saved = () => page.evaluate(() => window.__qaPreferences());
async function layouts(label) {
  for (const width of [360, 412, 915, 1024, 1366, 1920]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width > 700 ? 768 : 915 });
    await page.locator(".android-app").evaluate((node, theme) => node.dataset.theme = theme, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const overflow = await page.locator("button").evaluateAll(nodes => nodes.filter(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1); }).length);
    assert.equal(overflow, 0); result.layouts.push({ label, width, theme });
    if (label === "cover") assert.equal(await page.locator(".gz-continue-cover > span").evaluate(node => getComputedStyle(node).color), "rgb(255, 255, 255)");
    if (width === 412) await page.screenshot({ path: `${output}/${label}-${theme}.png` });
  }
  await page.setViewportSize({ width: 412, height: 915 });
}
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/genzo.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  const hardware = page.getByRole("switch", { name: /硬件解码/ }); await hardware.waitFor();
  await layouts("settings");
  await hardware.click(); await page.waitForFunction(() => !window.__qaPreferences().hardwareDecoding);
  assert.ok(await page.getByRole("button", { name: /硬件解码器/ }).isDisabled()); result.cases.hardwareDisablesDecoderSelection = true;
  await hardware.click(); await page.waitForFunction(() => window.__qaPreferences().hardwareDecoding);
  await page.getByRole("button", { name: /硬件解码器/ }).click(); await page.getByRole("radio", { name: /^mediacodec-copy/ }).click();
  await page.waitForFunction(() => window.__qaPreferences().hardwareDecoder === "mediacodec-copy"); assert.equal((await saved()).videoRenderer, "auto"); result.cases.decoderSelectionSaves = true;
  await layouts("decoder");
  await setPage("renderer"); await page.getByRole("radio", { name: /^低功耗直通/ }).click();
  await page.waitForFunction(() => window.__qaPreferences().videoRenderer === "mediacodec_embed"); assert.equal((await saved()).superResolution, 0); assert.equal((await saved()).hardwareDecoder, "mediacodec"); result.cases.directNormalizesIncompatibleSettings = true;
  await layouts("renderer");
  await setPage("super"); await page.getByRole("radio", { name: /^画质档/ }).click();
  await page.waitForFunction(() => window.__qaPreferences().superResolution === 2); assert.equal((await saved()).videoRenderer, "gpu"); result.cases.superResolutionPromotesDirectToGpu = true;
  await layouts("super");
  await page.evaluate(() => window.__qaSaveFail(true)); await page.getByRole("radio", { name: /^流畅档/ }).click(); await page.getByRole("alert").waitFor();
  assert.equal((await saved()).superResolution, 2); assert.equal(await page.getByRole("radio", { name: /^画质档/ }).getAttribute("aria-checked"), "true");
  await page.evaluate(() => window.__qaSaveFail(false)); await page.getByRole("button", { name: "重试保存" }).click(); await page.waitForFunction(() => window.__qaPreferences().superResolution === 1); result.cases.failedSaveRetainsAndRetries = true;
  await page.evaluate(() => { window.__qaOffline(true); window.__qaMode("cover"); });
  await page.waitForFunction(() => document.querySelector(".gz-continue-cover img")?.naturalWidth > 0);
  const first = await page.locator(".gz-continue-cover img").getAttribute("src");
  await layouts("cover"); result.cases.cachedEpisodeStillWorksOffline = true;
  await page.evaluate(() => window.__qaEpisode("bangumi:official-2"));
  await page.waitForFunction(first => document.querySelector(".gz-continue-cover img")?.src !== first && document.querySelector(".gz-continue-cover img")?.naturalWidth > 0, first);
  result.cases.officialEpisodeIdentityChangesImage = true;
  const count = await page.evaluate(() => window.__qaCalls.filter(call => call.type === "artwork-get").length);
  await page.evaluate(() => window.__qaEpisode(null)); await page.locator(".gz-continue-cover img").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__qaCalls.filter(call => call.type === "artwork-get").length), count); result.cases.unlinkedMediaDoesNotGuessEpisode = true;
  assert.deepEqual(errors, []); console.log(JSON.stringify(result));
} finally { writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser.close(); }
