import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { build } from "vite";
import { chromium } from "playwright-core";

const output = `D:/DevTools/Android/Build/qa/rules-ui-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/android-rules.tsx", name: "AndroidRulesFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.setDefaultTimeout(10000);
const errors = [], result = { output, cases: {}, layouts: [] };
page.on("pageerror", error => errors.push(String(error)));
const lastCall = type => page.evaluate(type => window.__qaCalls.findLast(call => call.type === type), type);
const switchMode = async mode => { await page.evaluate(mode => window.__qaMode(mode), mode); await page.getByRole("heading", { name: mode === "manager" ? "规则视频来源" : "规则搜索与剧集", exact: true }).waitFor(); };
const openFirst = async () => { await page.getByRole("button", { name: /续季编号验收：来源从第十三集开始/ }).click(); await page.getByRole("combobox", { name: /^播放线路/ }).waitFor(); };
const back = () => page.evaluate(() => window.__qaBack());
async function layouts(name) {
  for (const width of [360, 412, 915, 1024]) {
    await page.setViewportSize({ width, height: width > 700 ? 640 : 915 });
    for (const theme of ["dark", "light"]) {
      await page.locator(".android-app").evaluate((node, theme) => node.dataset.theme = theme, theme);
      await page.locator(".gz-scroll").evaluate(node => node.scrollTop = 0);
      const measured = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        return { width: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll(".android-app input, .android-app select, .android-app textarea, .android-app button, .gz-rule-episode, .gz-rule-catalog-row")].filter(node => {
          const rect = node.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > viewport + 1);
        }).map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 80), bounds: node.getBoundingClientRect().toJSON() })) };
      });
      assert.equal(measured.width, width, `${name} ${width}/${theme}: document overflow`);
      assert.deepEqual(measured.overflow, [], `${name} ${width}/${theme}: controls overflow`);
      await page.screenshot({ path: `${output}/${name}-${width}-${theme}.png` });
      result.layouts.push({ name, width, theme });
    }
  }
  await page.setViewportSize({ width: 412, height: 915 });
}
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/genzo.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.getByRole("button", { name: "浏览规则仓库", exact: true }).click();
  await page.locator(".gz-rule-catalog-row").filter({ hasText: "新安装规则" }).getByRole("button", { name: "安装", exact: true }).click();
  await page.locator("article.gz-rule-plugin").filter({ hasText: "新安装规则 · 1.0" }).waitFor();
  assert.equal((await lastCall("install")).name, "新安装规则"); result.cases.catalogInstall = true;
  const fast = page.locator("article.gz-rule-plugin").filter({ hasText: "快速规则 ·" });
  await fast.getByRole("button", { name: "编辑 JSON", exact: true }).click();
  assert.equal(await page.locator("details.gz-rule-import").evaluate(node => node.open), true);
  const json = page.locator("details.gz-rule-import textarea");
  assert.equal(JSON.parse(await json.inputValue()).name, "快速规则");
  await json.fill(JSON.stringify({ name: "快速规则", version: "3.0" }));
  await page.locator("details.gz-rule-import").getByRole("button", { name: "导入规则", exact: true }).click();
  await fast.getByText("快速规则 · 3.0", { exact: true }).waitFor(); result.cases.editImport = true;
  await json.fill("{invalid"); await page.locator("details.gz-rule-import").getByRole("button", { name: "导入规则", exact: true }).click(); await page.getByRole("alert").waitFor(); result.cases.invalidJsonError = true;
  await json.fill("https://fixture.invalid/custom-rule.json"); await page.locator("details.gz-rule-import").getByRole("button", { name: "导入规则", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "规则已保存" }).waitFor(); assert.equal((await lastCall("import-url")).url, "https://fixture.invalid/custom-rule.json"); result.cases.urlImport = true;
  await fast.getByRole("button", { name: "停用", exact: true }).click(); await fast.getByText("已停用", { exact: true }).waitFor(); assert.equal(await fast.getByRole("button", { name: "测试搜索", exact: true }).isDisabled(), true);
  await fast.getByRole("button", { name: "启用", exact: true }).click(); await fast.getByText("已启用", { exact: true }).waitFor(); result.cases.disableAndEnable = true;
  await fast.getByRole("button", { name: "更新规则", exact: true }).click(); await page.waitForFunction(() => window.__qaCalls.some(call => call.type === "update")); result.cases.updateRule = true;
  await layouts("manager");
  const installed = page.locator("article.gz-rule-plugin").filter({ hasText: "新安装规则 ·" }); await installed.getByRole("button", { name: "移除规则", exact: true }).click(); await page.getByText("作品和观看记录保留，此规则的播放来源将不可用。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "确认移除规则", exact: true }).click(); await installed.waitFor({ state: "detached" }); assert.equal((await lastCall("enabled")).remove, true); result.cases.explicitRemovalRetainsRecordsMessage = true;
  await fast.getByRole("button", { name: "测试搜索", exact: true }).click(); await page.getByRole("dialog").waitFor(); await page.getByRole("button", { name: "关闭规则测试", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "detached" }); result.cases.managerSearchDialog = true;

  await switchMode("work");
  await page.getByRole("button", { name: /续季编号验收：来源从第十三集开始/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "停止搜索", exact: true }).isVisible(), true);
  assert.ok(!(await page.getByRole("button", { name: "慢源返回的结果 慢速规则", exact: true }).count()));
  assert.equal(await page.getByRole("button", { name: /停用规则/ }).count(), 0);
  assert.equal(await page.evaluate(() => window.__qaCalls.some(call => call.type === "search" && call.pluginId === "disabled")), false); result.cases.parallelSearchFastResultsWithoutSlowCompletion = true;
  await page.getByText("受控测试：需要网页验证", { exact: true }).waitFor();
  const verification = page.locator(".gz-panel").filter({ hasText: "验证规则" }); await verification.getByRole("button", { name: "打开网页验证", exact: true }).click(); assert.equal((await lastCall("verify")).pluginId, "verify");
  assert.equal((await lastCall("verify")).url, "https://fixture.invalid/verification/search-redirect"); result.cases.searchVerificationUsesActualRedirectUrl = true;
  await page.getByText("Error: 受控测试：来源请求失败", { exact: true }).waitFor(); result.cases.sourceErrorAndVerification = true;
  assert.equal(await page.locator("button.gz-row-card").count(), 120); await page.getByRole("button", { name: "显示更多（120 / 121）", exact: true }).click(); assert.equal(await page.locator("button.gz-row-card").count(), 121); result.cases.searchResultAppend = true;
  await openFirst(); await page.evaluate(() => window.__qaReleaseSlow()); await page.getByRole("combobox", { name: /^播放线路/ }).waitFor(); assert.equal(await page.getByText("慢源返回的结果", { exact: true }).count(), 0); result.cases.slowResultsCannotOverwriteOpenedSubject = true;
  await page.getByRole("button", { name: "网页验证", exact: true }).click(); assert.equal((await lastCall("verify")).url, "https://fixture.invalid/verification/chapters-redirect");
  await page.getByRole("button", { name: "打开网页验证", exact: true }).click(); assert.equal((await lastCall("verify")).url, "https://fixture.invalid/verification/chapters-redirect"); result.cases.chaptersVerificationUsesActualRedirectUrl = true;
  assert.equal(await page.locator(".gz-rule-episode").count(), 96); assert.equal(await page.getByLabel("规则选集页", { exact: true }).inputValue(), "1"); result.cases.pageSize96 = true;
  await page.getByLabel("来源起始集号", { exact: true }).fill("13");
  await page.locator(".gz-rule-episode").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "下一页", exact: true }).click(); assert.equal(await page.locator(".gz-rule-episode").count(), 96);
  await page.locator(".gz-rule-episode").first().getByRole("checkbox").check(); await page.getByRole("button", { name: "预览关联（2 集）", exact: true }).click();
  const preview = await lastCall("binding-preview"); assert.deepEqual(preview.input.episodeIndexes, [0, 96]); assert.equal(preview.input.episodeOffset, 12); assert.equal(preview.input.replaceExisting, false); assert.equal(preview.input.workId, "work-qa"); result.cases.crossPageSelectionAndExplicitOffset = true;
  await page.getByText("第13集 → 官方第 1 集 · 官方第1集 · 保留原有关联与记录", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "确认关联规则剧集", exact: true }).isDisabled(), true); result.cases.existingMappingDefaultPreserved = true;
  await page.getByLabel("官方起始集号", { exact: true }).fill("2"); await page.locator('[aria-label="规则剧集关联预览"]').waitFor({ state: "detached" }); result.cases.offsetChangeInvalidatesPreview = true;
  await page.getByLabel("官方起始集号", { exact: true }).fill("1"); await page.getByRole("button", { name: "预览关联（2 集）", exact: true }).click();
  assert.equal(await back(), true); await page.locator('[aria-label="规则剧集关联预览"]').waitFor({ state: "detached" }); assert.equal(await page.getByRole("combobox", { name: /^播放线路/ }).isVisible(), true); result.cases.backClosesPreviewFirst = true;
  await page.getByRole("button", { name: "预览关联（2 集）", exact: true }).click();
  await page.getByRole("checkbox", { name: "重新设置已关联剧集的编号", exact: true }).check(); await page.locator('[aria-label="规则剧集关联预览"]').waitFor({ state: "detached" });
  await page.getByRole("checkbox", { name: "重新设置已关联剧集的编号", exact: true }).uncheck(); result.cases.replaceExistingChangeInvalidatesPreview = true;
  await page.getByRole("button", { name: "预览关联（2 集）", exact: true }).click(); await page.getByRole("checkbox", { name: "已核对作品、线路与逐集对应", exact: true }).check();
  await page.evaluate(() => window.__qaHoldBind(true)); await page.getByRole("button", { name: "确认关联规则剧集", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-qa-busy]").textContent === "true"); assert.equal(await back(), true);
  assert.equal(await page.locator('[aria-label="规则剧集关联预览"]').isVisible(), true); result.cases.savingBlocksBack = true; await page.evaluate(() => window.__qaReleaseBind());
  await page.waitForFunction(() => window.__qaCalls.some(call => call.type === "saved")); assert.deepEqual((await lastCall("bind")).input, preview.input); result.cases.reviewThenConfirmBinding = true;
  await page.getByRole("combobox", { name: /^播放线路/ }).selectOption("1"); assert.equal(await page.locator(".gz-rule-episode").count(), 3); await page.getByText("已选 0 / 3", { exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "预览关联（0 集）", exact: true }).isDisabled(), true); result.cases.roadChangeClearsSelection = true;
  await page.getByRole("combobox", { name: /^播放线路/ }).selectOption("0"); await page.getByLabel("规则选集页", { exact: true }).selectOption("3"); assert.equal(await page.locator(".gz-rule-episode").count(), 1); result.cases.lastEpisodePage = true;
  await page.getByLabel("规则选集页", { exact: true }).selectOption("1"); await page.locator(".gz-rule-episode").first().getByRole("checkbox").check(); await page.getByRole("button", { name: "预览关联（1 集）", exact: true }).click(); await layouts("binding");
  await page.locator('[aria-label="规则剧集关联预览"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/binding-preview-412-light.png` });
  await page.locator(".gz-rule-episode").nth(1).getByRole("checkbox").check(); await page.locator('[aria-label="规则剧集关联预览"]').waitFor({ state: "detached" }); result.cases.selectionChangeInvalidatesPreview = true;
  await page.getByRole("button", { name: "预览关联（2 集）", exact: true }).click();
  await back(); await page.locator(".gz-rule-episode").first().getByRole("button", { name: /^播放 / }).click(); await page.waitForFunction(() => window.__qaCalls.some(call => call.type === "play")); assert.equal((await lastCall("play")).input.episodeOffset, 12); assert.deepEqual((await lastCall("play")).input.episodeIndexes, [0]); assert.equal((await lastCall("play")).input.replaceExisting, false); result.cases.targetWorkPlaybackUsesBinding = true;
  await page.evaluate(() => window.__qaHoldPlayback(true)); await page.locator(".gz-rule-episode").first().getByRole("button", { name: /^播放 / }).click(); await page.getByRole("button", { name: "取消解析", exact: true }).waitFor(); assert.equal(await back(), true); await page.getByRole("button", { name: "取消解析", exact: true }).waitFor({ state: "detached" }); assert.ok(await lastCall("cancel-resolve")); assert.equal(await page.getByRole("combobox", { name: /^播放线路/ }).isVisible(), true); result.cases.backCancelsResolverBeforeLeavingSubject = true;
  await page.evaluate(() => { window.__qaPlaybackError("过期播放响应不应显示"); window.__qaReleasePlayback(); });
  await page.waitForFunction(() => window.__qaCalls.some(call => call.type === "playback-settled" && call.error === "过期播放响应不应显示")); assert.equal(await page.getByRole("alert").count(), 0); assert.equal(await page.getByRole("combobox", { name: /^播放线路/ }).isVisible(), true); result.cases.cancelledPlaybackErrorCannotChangeFrontend = true;
  await page.evaluate(() => window.__qaPlaybackError(null)); await page.locator(".gz-rule-episode").first().getByRole("button", { name: /^播放 / }).click(); await page.getByRole("button", { name: "取消解析", exact: true }).click();
  await page.getByRole("button", { name: "返回搜索结果", exact: true }).click(); const beforeLatePlayback = await page.evaluate(() => window.__qaCalls.filter(call => call.type === "play").length), beforeLateSettlement = await page.evaluate(() => window.__qaCalls.filter(call => call.type === "playback-settled").length); await page.evaluate(() => window.__qaReleasePlayback());
  await page.waitForFunction(count => window.__qaCalls.filter(call => call.type === "playback-settled").length > count, beforeLateSettlement);
  await page.getByLabel("搜索规则来源", { exact: true }).waitFor(); assert.equal(await page.getByRole("combobox", { name: /^播放线路/ }).count(), 0); assert.equal(await page.evaluate(() => window.__qaCalls.filter(call => call.type === "play").length), beforeLatePlayback); result.cases.cancelledPlaybackSuccessCannotReopenOrReplay = true;
  await openFirst();
  assert.equal(await back(), true); await page.getByLabel("搜索规则来源", { exact: true }).waitFor(); assert.equal(await back(), false); result.cases.backReturnsResultsThenParent = true;

  await switchMode("trial"); await page.getByLabel("搜索规则来源", { exact: true }).fill("试播验收"); await page.getByRole("button", { name: "搜索", exact: true }).click(); await openFirst();
  assert.equal(await page.locator(".gz-rule-episode input[type=checkbox]").count(), 0); await page.locator(".gz-rule-episode").first().getByRole("button", { name: /^试播 / }).click(); await page.waitForFunction(() => window.__qaCalls.some(call => call.type === "trial")); assert.equal((await lastCall("trial")).episodeIndex, 0); assert.equal((await page.evaluate(() => window.__qaCalls.filter(call => call.type === "play"))).length, 0); result.cases.trialDoesNotBindTargetWork = true; await layouts("trial");
  await switchMode("initial"); await page.getByRole("combobox", { name: /^播放线路/ }).waitFor(); assert.equal((await page.evaluate(() => window.__qaCalls.filter(call => call.type === "search"))).length, 0); result.cases.existingSourceOpensWithoutSearching = true;
  await page.locator(".gz-rule-episode").first().getByRole("checkbox").check(); await page.getByRole("button", { name: "预览关联（1 集）", exact: true }).click(); await page.evaluate(() => window.__qaFailBind(true)); await page.getByRole("checkbox", { name: "已核对作品、线路与逐集对应", exact: true }).check(); await page.getByRole("button", { name: "确认关联规则剧集", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "受控测试：保存失败" }).waitFor(); await page.locator('[aria-label="规则剧集关联预览"]').waitFor({ state: "detached" }); result.cases.saveFailureRequiresNewPreview = true;
  assert.deepEqual(errors, []); result.passed = true; writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { result.error = String(error); result.pageErrors = errors; await page.screenshot({ path: `${output}/failure.png` }); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error; }
finally { await browser.close(); }
