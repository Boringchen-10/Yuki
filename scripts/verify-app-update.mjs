import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = "D:/DevTools/Android/Build/qa/network-update-20261016/update-ui";
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/app-update.tsx", name: "AppUpdateFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", reason => errors.push(String(reason)));
try {
  await page.route("http://update.test/**", route => route.fulfill({ status: 200, contentType: "text/html", body: '<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>' }));
  await page.goto("http://update.test/");
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.getByText("当前版本 0.17.0", { exact: false }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__calls.filter(value => value !== "appUpdateStatus")), [], "opening About must not check or download automatically");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByText("发现新版本 v0.18.0", { exact: false }).waitFor();
  await page.getByRole("button", { name: "下载安装包", exact: true }).click();
  await page.getByRole("progressbar", { name: "安装包下载进度" }).waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("value"), String(10 * 1024 * 1024));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "下载安装包", exact: true }).waitFor();
  await page.getByRole("button", { name: "下载安装包", exact: true }).click();
  await page.evaluate(() => window.__setUpdate({ phase: "ready", bytes: 50 * 1024 * 1024 }));
  await page.getByRole("button", { name: "安装更新", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__calls.includes("installAppUpdate")), false, "finishing a download must not open the installer automatically");
  await page.getByRole("button", { name: "安装更新", exact: true }).click();
  await page.getByText("请允许此应用安装后返回", { exact: false }).waitFor();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.querySelector(".android-app").dataset.theme = theme, theme);
    for (const width of [360, 412, 915, 1024, 1366, 1920]) {
      await page.setViewportSize({ width, height: width < 700 ? 915 : 768 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme}/${width} overflow`);
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await page.evaluate(() => window.__setUpdate({ phase: "error", error: "安装包 SHA-256 校验失败，请重试" }));
  await page.getByRole("alert").filter({ hasText: "SHA-256" }).waitFor();
  await page.evaluate(() => window.__setUpdate({ phase: "current", version: "", error: "" }));
  await page.getByText("暂无适合此设备的更高正式版本", { exact: false }).waitFor();
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ passed: true, cases: ["manual check", "download progress", "cancel and retry", "explicit installation", "unknown source permission", "checksum error", "preview newer than public", "twelve size/theme combinations"], errors }, null, 2));
  console.log("Application update UI: 8 groups passed, 12 size/theme combinations.");
} finally { await browser.close(); }
