import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = `D:/DevTools/Android/Build/qa/discovery-playback-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"', __GENZO_ANDROID__: "true" }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/discovery-playback.tsx", name: "DiscoveryPlaybackFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce" });
const errors = [], cases = [];
page.on("pageerror", error => errors.push(String(error)));
const calls = kind => page.evaluate(kind => window.__calls.filter(call => call.kind === kind), kind);
const openSource = async () => {
  await page.locator(".gz-episode-cover").nth(1).click();
  await page.getByRole("dialog", { name: "播放来源", exact: true }).waitFor();
  await page.locator(".gz-play-source-main").click();
  await page.locator(".gz-play-source-result").click();
  await page.locator(".gz-play-source-episode").first().waitFor();
};
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.locator(".gz-cover").first().click();
  await page.locator(".gz-episode-cover").nth(1).waitFor();
  assert.equal(await page.locator(".gz-episode-cover").nth(1).isDisabled(), false);
  await openSource();
  assert.match(await page.locator(".gz-play-source").innerText(), /正在选择：第 2 集/);
  assert.equal((await calls("save")).length, 0); assert.equal((await calls("play")).length, 0);
  await page.evaluate(() => window.__genzoBack());
  await page.locator(".gz-play-source").waitFor({ state: "detached" });
  assert.equal(await page.locator(".gz-shared-anime-hero").count(), 1);
  assert.equal((await calls("save")).length, 0);
  cases.push("discovery episode searches the shared rules without changing library or personal data; Back closes the sheet first");

  await openSource();
  const layouts = [];
  for (const width of [360, 412, 915, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 915 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const bounds = await page.locator(".gz-play-source").boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    layouts.push(width);
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: `${output}/source-selection.png` });
  await page.evaluate(() => { window.__delaySave = true; });
  await page.locator(".gz-play-source-episode").nth(1).click();
  await page.waitForFunction(() => !!window.__finishSave);
  await page.locator(".gz-play-source-episode").nth(1).dispatchEvent("click");
  assert.equal((await calls("save")).length, 1);
  await page.evaluate(() => { window.__delaySave = false; window.__finishSave(); });
  await page.locator(".gz-play-source").waitFor({ state: "detached" });
  const save = (await calls("save"))[0].input, play = (await calls("play"))[0].input;
  assert.equal(save.externalId, "111"); assert.equal(save.favorite, false); assert.equal(save.status, "in_progress"); assert.equal(save.forPlayback, true);
  assert.equal(play.workId, "saved-111"); assert.deepEqual(play.episodeIndexes, [1]); assert.equal(play.targetEpisodeExternalId, "111-2");
  cases.push("only an explicit rule episode creates a work, deduplicates taps and carries the exact clicked official ID");

  await page.evaluate(() => window.__openSubject("333"));
  await page.locator(".gz-episode-cover").nth(1).waitFor();
  await openSource();
  await page.evaluate(() => { window.__delaySave = true; delete window.__finishSave; });
  await page.locator(".gz-play-source-episode").first().click();
  await page.waitForFunction(() => !!window.__finishSave);
  await page.evaluate(() => window.__genzoBack());
  await page.locator(".gz-play-source").waitFor({ state: "detached" });
  await page.evaluate(() => { window.__delaySave = false; window.__finishSave(); });
  await page.waitForTimeout(80);
  assert.equal((await calls("play")).length, 1);
  cases.push("closing while preparing a selected work prevents a late response from opening playback");

  await page.evaluate(() => window.__openSubject("444"));
  await page.locator(".gz-episode-cover").nth(1).waitFor();
  await page.getByRole("button", { name: "规则来源", exact: true }).click();
  await page.getByRole("dialog", { name: "播放来源", exact: true }).waitFor();
  assert.equal((await calls("save")).length, 2);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await openSource();
  await page.evaluate(() => { window.__failSave = true; });
  await page.locator(".gz-play-source-episode").first().click();
  await page.getByRole("alert").filter({ hasText: "受控保存失败" }).waitFor();
  assert.equal((await calls("play")).length, 1);
  assert.equal(await page.locator(".gz-play-source-episode").first().isDisabled(), false);
  cases.push("rule chip opens the same sheet without writes; save failures preserve selection and allow retry");
  assert.deepEqual(errors, []);
  const result = { output, cases, layouts, errors };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
