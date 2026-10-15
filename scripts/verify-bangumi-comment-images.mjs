import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const output = process.env.GENZO_COMMENT_IMAGE_QA_DIR || "D:/DevTools/Android/Build/qa/downloads-history-20261014/comment-images-browser";
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/bangumi-comment-images.tsx", name: "CommentImageFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const cases = [], errors = [];
page.on("pageerror", error => errors.push(String(error)));
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.waitForFunction(() => [...document.querySelectorAll(".gz-bangumi-image img")].length === 2 && [...document.querySelectorAll(".gz-bangumi-image img")].every(node => node.complete && node.naturalWidth === 640));
  const body = await page.locator(".gz-comment-body").innerText();
  assert.ok(body.includes("图片前正文") && body.includes("图片间正文") && body.includes("图片后正文"));
  assert.deepEqual(await page.evaluate(() => window.__qaCalls), ["https://lain.bgm.tv/a.jpg", "https://i.postimg.cc/b.png"]);
  cases.push("real image markup uses the bounded cache API and preserves surrounding text");
  for (const width of [360, 412, 915, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 915 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.equal(await page.locator(".gz-bangumi-image img").evaluateAll(nodes => nodes.some(node => node.getBoundingClientRect().right > innerWidth || node.getBoundingClientRect().left < 0)), false);
    if (width <= 412) await page.screenshot({ path: `${output}/images-${width}.png` });
  }
  cases.push("images render completely without overflow at six common window widths");
  await page.evaluate(() => window.__qaMount("fail"));
  await page.getByRole("button", { name: "图片加载失败，重试" }).waitFor();
  const before = await page.evaluate(() => window.__qaCalls.length);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__qaCalls.length), before);
  await page.evaluate(() => window.__qaRetry());
  await page.getByRole("button", { name: "图片加载失败，重试" }).click();
  await page.waitForFunction(() => document.querySelector(".gz-bangumi-image img")?.naturalWidth === 640);
  cases.push("failed images preserve text and retry only on explicit request");
  await page.evaluate(() => window.__qaMount("late"));
  await page.waitForFunction(() => window.__qaCalls.some(url => url.includes("late")));
  await page.evaluate(() => { window.__qaMount("plain"); window.__qaResolve(); });
  assert.equal(await page.locator(".gz-bangumi-image").count(), 0);
  assert.equal(await page.locator(".gz-comment-body img").count(), 0);
  await page.getByText(/普通文字/).waitFor();
  cases.push("late image replies cannot populate a new comment and HTML/local URLs remain plain text");
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, cases, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, output, cases }));
} finally { await browser.close(); }
