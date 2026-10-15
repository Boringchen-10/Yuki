import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = process.env.GENZO_DOWNLOAD_ENTRY_QA_DIR || "D:/DevTools/Android/Build/qa/downloads-history-20261014/download-entries-browser";
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/download-entries.tsx", name: "DownloadEntryFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [], cases = [];
page.on("pageerror", error => errors.push(String(error)));
const calls = command => page.evaluate(name => window.__qaCalls.filter(item => !name || item.command === name), command);
async function mount(mode) {
  await page.evaluate(value => window.__qaMount(value), mode);
  if (mode.startsWith("book")) await page.locator("[data-chapter-id]").last().waitFor();
  if (mode.startsWith("rules")) await page.locator(".gz-rule-episode").last().waitFor();
}
async function layout(name) {
  await page.waitForTimeout(450);
  for (const width of [360, 412, 1024]) {
    await page.setViewportSize({ width, height: 915 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, name);
    const overflow = await page.locator("button,select,input,.gz-rule-episode").evaluateAll(nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect(); return rect.width && (rect.left < -1 || rect.right > innerWidth + 1);
    }).map(node => ({ text: node.textContent, className: node.className })));
    assert.deepEqual(overflow, [], `${name} at ${width}`);
    if (width === 412) await page.screenshot({ path: `${output}/${name}-412.png` });
  }
}
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.locator("[data-chapter-id]").last().waitFor();
  await layout("comic-chapters");
  await page.locator('[data-chapter-id="default-1"]').click();
  await page.locator('[data-chapter-id="default-3"]').click();
  await page.getByRole("button", { name: "下载 2 项", exact: true }).click();
  await page.waitForFunction(() => window.__qaCalls.some(item => item.command === "fixture-selecting" && item.args.value === false));
  const comic = (await calls("enqueue_book_downloads")).at(-1).args;
  assert.deepEqual(comic, { kind: "comic", pathWord: "qa-book", group: "default", title: "合成书籍", entries: [{ id: "default-1", title: "第1话" }, { id: "default-3", title: "第3话" }] });
  assert.equal((await calls("cache_book_source_content")).length, 0);
  await page.evaluate(() => window.__qaFinishBooks());
  await page.waitForFunction(() => [...document.querySelectorAll(".gz-chapter-badge")].every(node => node.textContent === "已下载"));
  cases.push("comic selection enqueues only the chosen stable IDs without synchronously downloading, and completion events refresh cache badges");
  await mount("book-novel");
  await page.getByRole("tab", { name: /单行本/ }).click();
  await page.locator('[data-chapter-id="volumes-1"]').waitFor();
  await page.getByRole("button", { name: "全选本页", exact: true }).click();
  await page.evaluate(() => window.__qaFlag("slow", true));
  const beforeBook = (await calls("enqueue_book_downloads")).length;
  await page.getByRole("button", { name: "下载 3 项", exact: true }).dblclick();
  await page.getByRole("button", { name: "正在加入…", exact: true }).waitFor();
  assert.equal((await calls("enqueue_book_downloads")).length, beforeBook + 1);
  const novel = (await calls("enqueue_book_downloads")).at(-1).args;
  assert.equal(novel.kind, "novel"); assert.equal(novel.group, "volumes");
  assert.deepEqual(novel.entries.map(item => item.id), ["volumes-1", "volumes-2", "volumes-3"]);
  const beforeToast = (await calls("fixture-toast")).length;
  await page.evaluate(() => { window.__qaUnmount(); window.__qaResolve(); });
  await page.waitForTimeout(50);
  assert.equal((await calls("fixture-toast")).length, beforeToast);
  cases.push("novel grouped selection retains group identity, deduplicates a repeated click, and survives leaving the details without stale UI feedback");
  for (const mode of ["rules-unbound", "rules-bound"]) {
    await mount(mode); await layout(mode);
    await page.getByRole("button", { name: "下载 第1集", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已加入下载中心（1 集）" }).waitFor();
    let input = (await calls("enqueue_rule_downloads")).at(-1).args.input;
    assert.equal(input.pluginId, "qa-rule"); assert.equal(input.source, "/work/qa-stable"); assert.equal(input.roadIndex, 0);
    assert.deepEqual(input.episodeIndexes, [0]); assert.equal(input.workId, mode === "rules-bound" ? "qa-work" : undefined);
    await page.getByRole("button", { name: "选择当前页剧集", exact: true }).click();
    await page.getByRole("button", { name: "下载所选（3 集）", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已加入下载中心（3 集）" }).waitFor();
    assert.deepEqual((await calls("enqueue_rule_downloads")).at(-1).args.input.episodeIndexes, [0, 1, 2]);
    await page.getByLabel("播放线路").selectOption("1");
    assert.equal(await page.getByRole("button", { name: "下载所选（0 集）", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "下载 第12集", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已加入下载中心（1 集）" }).waitFor();
    input = (await calls("enqueue_rule_downloads")).at(-1).args.input;
    assert.equal(input.roadIndex, 1); assert.deepEqual(input.episodeIndexes, [1]);
  }
  assert.equal((await calls("play_rule_episode")).length, 0); assert.equal((await calls("preview_rule_episode")).length, 0);
  cases.push("bound and unbound rule screens enqueue single/batch episodes with exact road/index identity; changing roads clears selections and downloads never start playback");
  await mount("rules-unbound");
  await page.evaluate(() => window.__qaFlag("fail", true));
  await page.getByRole("button", { name: "下载 第1集", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "合成入队失败" }).waitFor();
  assert.equal(await page.getByRole("status").filter({ hasText: "已加入下载中心" }).count(), 0);
  await page.evaluate(() => window.__qaFlag("fail", false));
  await page.getByRole("button", { name: "下载 第1集", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已加入下载中心（1 集）" }).waitFor();
  cases.push("rule enqueue failures do not report success and can retry explicitly");
  await mount("episodes"); await layout("episode-downloads");
  await page.getByRole("button", { name: "第 1 集 设置", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "下载此视频", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已加入下载中心" }).waitFor();
  assert.deepEqual((await calls("enqueue_file_download")).at(-1).args, { mediaFileId: "dav" });
  await mount("episodes");
  await page.getByRole("button", { name: "第 2 集 设置", exact: true }).click();
  await page.getByRole("button", { name: "下载此视频", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已加入下载中心" }).waitFor();
  assert.deepEqual((await calls("enqueue_rule_media_download")).at(-1).args, { mediaFileId: "rule" });
  await mount("episodes");
  assert.equal(await page.getByRole("button", { name: "第 3 集 设置", exact: true }).count(), 0);
  await page.getByRole("button", { name: "第 4 集 设置", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "下载此视频", exact: true }).isDisabled(), true);
  cases.push("episode sheets queue WebDAV files and bound rules through distinct stable-media commands; local files get no download action and missing files are disabled");
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, widths: [360, 412, 1024], cases, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, output, cases }));
} finally { await browser.close(); }
