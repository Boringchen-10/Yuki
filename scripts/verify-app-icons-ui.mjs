import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = `D:/DevTools/Android/Build/qa/app-icons-20261017/ui-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, publicDir: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" },
  build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/android-app-icons.tsx", name: "IconFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const server = createServer((req, res) => {
  const path = req.url === "/" ? null : resolve(`${output}/fixture${req.url}`);
  if (!path) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/genzo.css"><div id="root"></div><script src="/fixture.js"></script>'); return; }
  try { res.setHeader("content-type", path.endsWith(".png") ? "image/png" : path.endsWith(".css") ? "text/css" : "text/javascript"); res.end(readFileSync(path)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [], result = { cases: [], layouts: [], output };
page.on("pageerror", error => errors.push(String(error)));
const selected = label => page.getByRole("radio", { name: new RegExp(label) }).getAttribute("aria-checked");
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('[role="radio"]')?.getAttribute("aria-checked") === "true");
  assert.equal(await selected("经典校服"), "true"); result.cases.push("native default classic");
  await page.getByRole("radio", { name: /贝雷帽约会/ }).click();
  assert.equal(await page.getByRole("radio", { name: /围巾冬装/ }).isDisabled(), true);
  await page.getByText("图标已切换，系统桌面可能需要几秒刷新。", { exact: true }).waitFor();
  assert.equal(await selected("贝雷帽约会"), "true"); result.cases.push("switch and pending guard");
  await page.evaluate(() => window.__iconRemount());
  await page.waitForFunction(() => document.querySelectorAll('[role="radio"]')[1]?.getAttribute("aria-checked") === "true");
  result.cases.push("remount reads native selection");
  await page.evaluate(() => window.__iconFail(true));
  await page.getByRole("radio", { name: /围巾冬装/ }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await selected("贝雷帽约会"), "true"); result.cases.push("failure keeps confirmed selection");
  await page.evaluate(() => window.__iconFail(false));
  await page.getByRole("radio", { name: /围巾冬装/ }).click();
  await page.waitForFunction(() => window.__iconStored() === "winter");
  assert.equal(await selected("围巾冬装"), "true"); result.cases.push("retry and third variant");
  const count = await page.evaluate(() => window.__iconCalls());
  await page.getByRole("radio", { name: /围巾冬装/ }).click();
  assert.equal(await page.evaluate(() => window.__iconCalls()), count); result.cases.push("same selection is no-op");
  for (const width of [360, 412, 915, 1024, 1366, 1920]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width > 700 ? 768 : 915 });
    await page.locator(".android-app").evaluate((node, theme) => node.dataset.theme = theme, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.equal(await page.locator(".gz-app-icon img").evaluateAll(nodes => nodes.every(node => node.complete && node.naturalWidth === 256)), true);
    for (const radio of await page.getByRole("radio").all()) { const box = await radio.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44); }
    result.layouts.push({ width, theme });
    if ([360, 412].includes(width)) await page.screenshot({ path: `${output}/${width}-${theme}.png` });
  }
  assert.deepEqual(errors, []); result.passed = true;
} catch (error) {
  result.error = String(error); result.pageErrors = errors;
  result.body = await page.locator("body").innerText();
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally {
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser.close(); server.close();
}
console.log(JSON.stringify(result));
