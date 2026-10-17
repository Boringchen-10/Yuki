import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const output = `D:/DevTools/Android/Build/qa/rules-update-20261017/ui-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, publicDir: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/rule-catalog.tsx", name: "CatalogFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
const result = { output, layouts: [], cases: [] };
try {
  await page.setContent('<meta charset="utf-8"><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/yuki.css`, "utf8") });
  await page.addScriptTag({ path: `${output}/fixture/fixture.js` });
  await page.getByRole("button", { name: "规则仓库", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: "规则仓库", exact: true });
  await catalog.locator("article").first().getByRole("button", { name: "更新", exact: true }).click();
  const alert = catalog.getByRole("alert");
  await alert.waitFor({ timeout: 3000 });
  assert.match(await alert.innerText(), /API 1–8/);
  result.cases.push("update error is visible inside catalog");
  assert.equal((await page.evaluate(() => window.__plugins()))[0].version, "1.0");
  await page.evaluate(() => window.__catalogFail(false));
  await catalog.locator("article").first().getByRole("button", { name: "更新", exact: true }).click();
  await catalog.locator("article").first().getByRole("button", { name: "重新获取", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__plugins()))[0].enabled, false);
  assert.equal((await page.evaluate(() => window.__plugins()))[0].id, "old-rule");
  result.cases.push("retry updates version without changing identity or enabled state");
  for (const [width, height] of [[360, 640], [412, 915], [915, 412], [1024, 640], [1366, 768], [1920, 1080]]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height });
    await page.locator(".android-app").evaluate((node, theme) => node.dataset.theme = theme, theme);
    const header = await catalog.locator("header").boundingBox(); assert.ok(header.y >= 38, "header clears status bar");
    const list = catalog.locator(".gz-rule-catalog");
    await list.evaluate(node => node.scrollTop = node.scrollHeight);
    const bounds = await list.boundingBox();
    const last = await catalog.locator("article").last().boundingBox(); assert.ok(last.y >= bounds.y - 1 && last.y + last.height <= height - 20, "last row reachable above bottom inset");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({ path: `${output}/${width}-${theme}.png` }); result.layouts.push({ width, height, theme });
  }
  result.passed = true;
} catch (error) { result.error = String(error); throw error; }
finally { writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser.close(); }
console.log(JSON.stringify(result));
