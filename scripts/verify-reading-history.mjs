import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = process.env.GENZO_READING_HISTORY_QA_DIR || "D:/DevTools/Android/Build/qa/downloads-history-20261014/reading-history-browser";
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/reading-history.tsx", name: "ReadingHistoryFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [], cases = [], widths = [360, 412, 1024];
page.on("pageerror", error => errors.push(String(error)));
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.locator(".gz-history-row").last().waitFor();
  assert.equal(await page.getByText("第 13 页 / 共 48 页", { exact: true }).count(), 1);
  assert.equal(await page.getByText("本卷已读 37%", { exact: true }).count(), 1);
  assert.equal(await page.getByText("第 5 页", { exact: true }).count(), 1);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 915 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const rows = await page.locator(".gz-history-row").evaluateAll(nodes => nodes.map(node => {
      const row = node.getBoundingClientRect(), body = node.querySelector(".gz-history-body").getBoundingClientRect(), actions = node.querySelector(".gz-history-actions").getBoundingClientRect();
      return { within: row.left >= 0 && row.right <= innerWidth && body.right <= actions.left,
        targets: [...node.querySelectorAll("button")].every(button => { const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; }) };
    }));
    assert.ok(rows.every(row => row.within && row.targets), `${width}: ${JSON.stringify(rows)}`);
    await page.screenshot({ path: `${output}/reading-history-${width}.png` });
  }
  cases.push("comic pages and novel volume progress show saved locations; long titles fit mobile/desktop widths without overlapping 44px actions");
  const before = await page.evaluate(() => JSON.stringify(window.__qaItems));
  for (const row of await page.locator(".gz-history-row").all()) await row.getByRole("button", { name: /^继续阅读/ }).click();
  let calls = await page.evaluate(() => window.__qaCalls);
  assert.deepEqual(calls.filter(item => item.action === "read").map(({ item }) => [item.kind, item.pathWord, item.group, item.entryId]), [
    ["comic", "qa-comic", "default", "chapter-1"], ["novel", "qa-novel", "volumes", "volume-2"], ["comic", "qa-unbound-comic", "volumes", "chapter-1"],
  ]);
  await page.locator(".gz-history-row").first().getByRole("button", { name: /^查看/ }).click();
  assert.equal(await page.locator(".gz-history-row").nth(2).getByRole("button", { name: /^查看/ }).count(), 0);
  await page.locator(".gz-history-row").nth(1).getByRole("button", { name: "更多操作", exact: true }).click();
  calls = await page.evaluate(() => window.__qaCalls);
  assert.equal(calls.find(item => item.action === "detail").item.workId, "qa-comic-work");
  assert.equal(calls.find(item => item.action === "more").item.entryId, "volume-2");
  cases.push("continue/detail/more callbacks preserve exact source/group/entry identity, including reading without a library work");
  await page.evaluate(() => window.__qaBusy(true));
  assert.equal(await page.getByRole("button", { name: /^继续阅读/ }).first().isDisabled(), true);
  await page.evaluate(() => { window.__qaBusy(false); window.__qaEdit(true); });
  assert.equal(await page.getByRole("button", { name: /^继续阅读/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^移除/ }).count(), 3);
  await page.getByRole("button", { name: /^移除/ }).nth(2).click();
  calls = await page.evaluate(() => window.__qaCalls);
  const removed = calls.filter(item => item.action === "remove");
  assert.equal(removed.length, 1); assert.equal(removed[0].item.pathWord, "qa-unbound-comic"); assert.equal(removed[0].item.group, "volumes");
  assert.equal(await page.evaluate(() => JSON.stringify(window.__qaItems)), before);
  await page.evaluate(() => window.__qaBusy(true));
  assert.equal(await page.getByRole("button", { name: /^移除/ }).first().isDisabled(), true);
  cases.push("edit mode removes only the chosen history identity, preserves the saved reading item, and locks duplicate busy actions");
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, widths, cases, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, output, cases }));
} finally { await browser.close(); }
