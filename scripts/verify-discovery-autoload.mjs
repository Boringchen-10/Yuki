import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = process.env.GENZO_DISCOVERY_QA_DIR || "D:/DevTools/Android/Build/qa/comment-ui-20261013/discovery";
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/discovery-autoload.tsx", name: "DiscoveryFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const cases = [], errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.setDefaultTimeout(8000);
const calls = scope => page.evaluate(scope => window.__qaCalls.filter(call => call.scope === scope), scope);
const mode = (scope, mode) => page.evaluate(({ scope, mode }) => window.__qaMode(scope, mode), { scope, mode });
const bottom = () => page.locator(".gz-scroll").evaluate(node => { node.scrollTop = node.scrollHeight; });
const top = () => page.locator(".gz-scroll").evaluate(node => { node.scrollTop = 0; });
const waitCards = count => page.waitForFunction(count => document.querySelectorAll(".gz-explore-grid > button, .gz-comic-grid-lg > button").length === count, count);
async function stable(scope) { const before = (await calls(scope)).length; await page.waitForTimeout(250); assert.equal((await calls(scope)).length, before); }
async function search(term) { await page.getByRole("searchbox").fill(term); await page.getByRole("searchbox").press("Enter"); }
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await waitCards(24);
  await mode("popular", "fail"); await bottom();
  await page.getByRole("button", { name: "重试更多热门番组", exact: true }).waitFor();
  await waitCards(24); await stable("popular");
  await mode("popular", "normal"); await page.getByRole("button", { name: "重试更多热门番组", exact: true }).click();
  await waitCards(47); await bottom(); await waitCards(48);
  assert.deepEqual((await calls("popular")).map(call => call.page), [1, 2, 2, 3]);
  cases.push("popular auto paging preserves rows on failure and retries same page");

  await top(); await page.getByRole("tab", { name: "漫画", exact: true }).click();
  await page.getByText("推荐", { exact: true }).waitFor();
  await page.locator(".gz-section").filter({ has: page.getByText("推荐", { exact: true }) }).getByRole("button", { name: "更多", exact: true }).click();
  await waitCards(24); await mode("section", "fail"); await bottom();
  await page.getByRole("button", { name: "重试更多漫画", exact: true }).waitFor(); await waitCards(24); await stable("section");
  await mode("section", "delay"); await page.getByRole("button", { name: "重试更多漫画", exact: true }).click();
  await bottom(); await bottom(); await stable("section");
  await mode("section", "normal"); await page.evaluate(() => window.__qaRelease());
  await waitCards(47); await bottom(); await waitCards(59);
  assert.deepEqual((await calls("section")).map(call => call.offset), [0, 24, 24, 48]);
  assert.equal(await page.getByRole("button", { name: /^加载更多/ }).count(), 0);
  cases.push("comic sections deduplicate and advance by source offset despite overlap");
  cases.push("pending repeated scroll cannot duplicate a section request");

  await page.getByRole("button", { name: "返回发现", exact: true }).click(); await top();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await search("漫画搜索"); await waitCards(24);
  await mode("comicSearch", "fail"); await bottom();
  await page.getByRole("button", { name: "重试搜索", exact: true }).waitFor(); await waitCards(24); await stable("comicSearch");
  await mode("comicSearch", "normal"); await page.getByRole("button", { name: "重试搜索", exact: true }).click();
  await waitCards(47); await bottom(); await waitCards(59);
  assert.deepEqual((await calls("comicSearch")).map(call => call.page), [1, 2, 2, 3]);
  cases.push("comic search uses existing paged source and explicit failure retry");
  await mode("comicSearch", "delay"); await search("旧搜索");
  await mode("comicSearch", "normal"); await search("新搜索"); await waitCards(24);
  await page.evaluate(() => window.__qaRelease()); await page.waitForTimeout(50);
  assert.equal(await page.getByText("旧搜索 0", { exact: true }).count(), 0);
  await page.getByText("新搜索 0", { exact: true }).waitFor();
  cases.push("late search response cannot replace the current query");

  await page.getByRole("tab", { name: "轻小说", exact: true }).click(); await top(); await waitCards(24);
  await mode("slowTheme", "delay"); await page.getByRole("radio", { name: "慢题材", exact: true }).click();
  await page.getByRole("radio", { name: "快题材", exact: true }).click(); await waitCards(24);
  await page.evaluate(() => window.__qaRelease()); await page.waitForTimeout(50);
  assert.equal(await page.getByText("slow 0", { exact: true }).count(), 0);
  await page.getByText("fast 0", { exact: true }).waitFor();
  cases.push("late novel theme response cannot replace current theme");
  await mode("novelList", "fail"); await bottom();
  await page.getByRole("button", { name: "重试更多轻小说", exact: true }).waitFor(); await waitCards(24); await stable("novelList");
  await mode("novelList", "normal"); await page.getByRole("button", { name: "重试更多轻小说", exact: true }).click(); await waitCards(47);
  await mode("novelList", "empty"); await bottom();
  await page.getByRole("button", { name: "重试更多轻小说", exact: true }).waitFor(); await waitCards(47); await stable("novelList");
  await mode("novelList", "normal"); await page.getByRole("button", { name: "重试更多轻小说", exact: true }).click(); await waitCards(59);
  assert.deepEqual((await calls("novelList")).filter(call => call.theme === "fast").map(call => call.page), [1, 2, 2, 3, 3]);
  cases.push("novel append failure preserves cards and original cursor");
  cases.push("empty page with remaining total pauses automatic paging");

  await top(); await page.getByRole("button", { name: "搜索", exact: true }).click();
  await search("小说搜索"); await waitCards(24);
  await page.evaluate(() => window.__qaActive(false)); await bottom(); await stable("novelSearch");
  assert.deepEqual((await calls("novelSearch")).map(call => call.page), [1]);
  await page.evaluate(() => window.__qaActive(true)); await waitCards(47); await bottom(); await waitCards(59);
  assert.deepEqual((await calls("novelSearch")).map(call => call.page), [1, 2, 3]);
  cases.push("hidden discovery does not request more and resumes when active");
  cases.push("novel search auto pages with no load-more buttons");
  for (const width of [360, 412, 915, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 915 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ cases, errors }, null, 2));
  console.log(JSON.stringify({ output, cases, errors }));
} finally { await browser.close(); }
