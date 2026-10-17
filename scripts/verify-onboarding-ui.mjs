import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = `D:/DevTools/Android/Build/qa/onboarding-20261017/ui-${Date.now()}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, publicDir: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" },
  build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/onboarding.tsx", name: "OnboardingFixture", formats: ["iife"], fileName: () => "fixture.js" } } });
const server = createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/?")) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/yuki.css"><div id="root"></div><script src="/fixture.js"></script>'); return; }
  try { const path = resolve(`${output}/fixture${req.url}`); res.setHeader("content-type", path.endsWith(".css") ? "text/css" : "text/javascript"); res.end(readFileSync(path)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const result = { output, cases: [], layouts: [] }, errors = [];
page.on("pageerror", error => errors.push(String(error)));
const consent = () => page.getByRole("button", { name: "同意并继续", exact: true });
const enter = () => page.getByRole("button", { name: "进入 Yuki（可稍后添加）", exact: true });
const stats = () => page.evaluate(() => window.__onboarding.stats());
const reset = async () => { await page.evaluate(() => window.__onboarding.reset()); await consent().waitFor(); };
const accept = async () => { await page.getByRole("checkbox").check(); await consent().click(); await enter().waitFor(); };
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/explore`);
  await consent().waitFor();
  assert.ok(await consent().isDisabled());
  assert.equal((await stats()).catalogCalls, 0); assert.equal((await stats()).backgroundCalls, 0);
  result.cases.push("fresh install and deep link cannot bypass unchecked agreement; no source/background calls");
  await page.getByRole("button", { name: "暂不同意", exact: true }).click();
  await page.getByRole("heading", { name: "尊重你的选择" }).waitFor();
  assert.equal(await page.evaluate(() => window.__genzoBack()), true);
  assert.ok(await consent().isDisabled());
  assert.equal(await page.evaluate(() => window.__genzoBack()), false);
  result.cases.push("decline remains gated; back returns to agreement or lets Android leave");
  await page.evaluate(() => window.__onboarding.storageFail(false, true));
  await page.getByRole("checkbox").check(); await consent().click();
  await page.getByRole("alert").waitFor(); assert.equal((await stats()).catalogCalls, 0);
  await page.evaluate(() => window.__onboarding.storageFail(false, false)); await consent().click();
  await enter().waitFor();
  result.cases.push("failed consent write stays closed; retry reaches sources");
  await page.evaluate(() => window.__onboarding.remount()); await enter().waitFor();
  assert.equal((await stats()).backgroundCalls, 0);
  result.cases.push("restart after agreement resumes source setup without background startup");
  await page.getByRole("button", { name: "规则仓库", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: "规则仓库", exact: true });
  await page.evaluate(() => window.__onboarding.installFail(true));
  await catalog.locator("article").first().getByRole("button", { name: "安装", exact: true }).click();
  await catalog.getByRole("alert").waitFor(); assert.equal((await stats()).plugins.length, 0);
  await page.evaluate(() => window.__onboarding.installFail(false));
  await catalog.locator("article").first().getByRole("button", { name: "安装", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.gz-onboarding-footer button.primary')?.disabled === true);
  assert.equal(await page.evaluate(() => window.__genzoBack()), true);
  await catalog.locator("article").first().getByRole("button", { name: "重新获取", exact: true }).waitFor();
  assert.equal((await stats()).plugins.length, 1);
  await page.evaluate(() => window.__genzoBack()); await catalog.waitFor({ state: "detached" });
  result.cases.push("catalog failure/retry, successful install and busy/back protection");
  await page.getByRole("button", { name: "添加规则", exact: true }).click();
  await page.getByRole("button", { name: /新建规则/ }).click();
  const editor = page.locator("dialog[open]");
  await editor.locator("textarea").fill("https://example.org/rule.json");
  await editor.getByRole("button", { name: "保存规则" }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal((await stats()).plugins.length, 2); result.cases.push("custom rule URL imports through existing manager");
  await page.evaluate(() => window.__onboarding.storageFail(false, true)); await enter().click();
  await page.getByRole("alert").waitFor(); assert.equal((await stats()).backgroundCalls, 0);
  await page.evaluate(() => window.__onboarding.storageFail(false, false)); await enter().click();
  await page.getByRole("heading", { name: "已进入主应用" }).waitFor();
  await page.reload(); await page.getByRole("heading", { name: "已进入主应用" }).waitFor();
  result.cases.push("completion write failure remains gated; completed restart skips wizard");
  await reset(); await accept(); await enter().click();
  await page.getByRole("heading", { name: "已进入主应用" }).waitFor();
  assert.equal((await stats()).plugins.length, 0); result.cases.push("local-media users can finish without rules");
  await reset(); await page.evaluate(() => { window.__onboarding.storageFail(true, false); window.__onboarding.remount(); });
  await page.getByRole("alert").waitFor(); await page.getByRole("checkbox").check(); assert.ok(await consent().isDisabled());
  await page.evaluate(() => window.__onboarding.storageFail(false, false)); await page.getByRole("button", { name: "重试", exact: true }).click();
  assert.equal(await consent().isDisabled(), false); result.cases.push("storage read failure cannot bypass gate and is recoverable");
  await page.evaluate(() => { localStorage.setItem("yuki-android-onboarding", JSON.stringify({ agreementVersion: "old", acceptedAt: new Date().toISOString(), completedAt: new Date().toISOString() })); window.__onboarding.remount(); });
  await consent().waitFor(); assert.ok(await consent().isDisabled()); result.cases.push("changed agreement requires fresh explicit consent");
  for (const stage of ["agreement", "sources", "catalog"]) {
    await reset(); if (stage !== "agreement") await accept();
    if (stage === "catalog") await page.getByRole("button", { name: "规则仓库", exact: true }).click();
    for (const [width, height] of [[320, 568], [360, 640], [412, 915], [915, 412]]) for (const theme of ["light", "dark"]) for (const scale of [100, 150]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(({ theme, scale }) => window.__onboarding.appearance(theme, scale), { theme, scale });
      await page.waitForFunction(theme => document.querySelector(".android-app")?.dataset.theme === theme, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const main = await page.locator(".gz-onboarding-scroll").boundingBox(); assert.ok(main.height > 100);
      assert.ok(await page.locator(".gz-onboarding-scroll").evaluate(node => parseFloat(getComputedStyle(node).paddingTop) >= 38));
      if (stage !== "catalog") {
        if (stage === "agreement") assert.equal(await page.locator(".gz-onboarding-check").evaluate(node => getComputedStyle(node).flexDirection), "row");
        await page.locator(".gz-onboarding-scroll").evaluate(node => node.scrollTop = node.scrollHeight);
        const button = await (stage === "agreement" ? consent() : enter()).boundingBox();
        assert.ok(button.y >= 38 && button.y + button.height <= height - 24 && button.height >= 44);
        const last = await page.locator(".gz-onboarding-content").boundingBox(); assert.ok(last.y + last.height <= main.y + main.height + 1);
      } else {
        await catalog.locator(".gz-rule-catalog").evaluate(node => node.scrollTop = node.scrollHeight);
        const last = await catalog.locator("article").last().boundingBox(); assert.ok(last.y + last.height <= height - 24);
      }
      if (scale === 100 && width === 412) {
        await page.locator(".gz-onboarding-scroll").evaluate(node => node.scrollTop = 0);
        await page.screenshot({ path: `${output}/${stage}-${theme}.png`, animations: "disabled" });
      }
      result.layouts.push({ stage, width, height, theme, scale });
    }
  }
  assert.deepEqual(errors, []); result.passed = true;
} catch (error) {
  result.error = String(error); result.pageErrors = errors;
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally { writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser.close(); server.close(); }
console.log(JSON.stringify(result));
