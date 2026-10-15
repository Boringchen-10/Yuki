import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const output = "D:/DevTools/Android/Build/qa/player-theme-20261015/browser";
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"', __GENZO_ANDROID__: "true" }, esbuild: { jsx: "automatic" }, build: { outDir: `${output}/fixture`, lib: { entry: "scripts/fixtures/mixed-history.tsx", name: "AppearanceFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce" });
const errors = [], cases = [];
page.on("pageerror", error => errors.push(String(error)));
const latest = () => page.evaluate(() => window.__qaCalls.filter(call => call.command === "set_android_appearance").at(-1)?.args);
const waitMode = mode => page.waitForFunction(mode => window.__qaCalls.filter(call => call.command === "set_android_appearance").at(-1)?.args.appearance?.mode === mode, mode);
try {
  await page.route("http://appearance.test/**", route => route.fulfill({ status: 200, contentType: "text/html", body: '<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>' }));
  await page.goto("http://appearance.test/");
  await page.addStyleTag({ content: readFileSync(`${output}/fixture/fixture.css`, "utf8") });
  await page.addScriptTag({ content: readFileSync(`${output}/fixture/fixture.js`, "utf8") });
  await page.locator(".gz-history-row").first().waitFor();
  await page.evaluate(() => { location.hash = "#/appearance"; });
  await page.getByLabel("主题模式", { exact: true }).waitFor();
  async function assertMatches() {
    const value = await latest();
    const current = await page.evaluate(() => {
      const root = document.querySelector(".android-app");
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      const span = document.createElement("span"); root.append(span);
      const color = (name, background = "#000000") => {
        span.style.color = `var(--${name})`;
        context.fillStyle = background; context.fillRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(span).color; context.fillRect(0, 0, 1, 1);
        return "#" + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join("");
      };
      const background = color("bg");
      const result = { dark: root.dataset.theme === "dark", palette: { background, raised: color("bg-raised", background), surface: color("surface", background), menu: color("surface-strong", background), text: color("text"), muted: color("muted"), accent: color("accent"), accentInk: color("accent-ink") } };
      span.remove(); return result;
    });
    assert.equal(value.dark, current.dark);
    assert.deepEqual(value.appearance[current.dark ? "dark" : "light"], current.palette);
    for (const palette of [value.appearance.dark, value.appearance.light]) assert.ok(Object.values(palette).every(color => /^#[0-9a-f]{6}$/.test(color)));
    assert.equal(await page.locator("body > .android-app").count(), 0, "theme probe must not remain mounted");
  }
  for (const mode of ["light", "dark", "system"]) {
    await page.getByLabel("主题模式", { exact: true }).selectOption(mode); await waitMode(mode); await assertMatches(); cases.push(`${mode}-matches-real-css`);
  }
  await page.getByLabel("主题模式", { exact: true }).selectOption("dark"); await waitMode("dark");
  const old = await latest();
  await page.getByRole("button", { name: "主题色 #3b6cf6", exact: true }).click();
  await page.waitForFunction(old => window.__qaCalls.filter(call => call.command === "set_android_appearance").at(-1)?.args.appearance?.dark.accent !== old, old.appearance.dark.accent);
  await assertMatches(); cases.push("custom-accent-syncs-without-changing-mode");
  await page.getByRole("switch", { name: /AMOLED/ }).check();
  await page.waitForFunction(() => window.__qaCalls.filter(call => call.command === "set_android_appearance").at(-1)?.args.appearance?.dark.background === "#000000");
  await assertMatches(); cases.push("amoled-syncs-black-background");
  await page.getByLabel("主题模式", { exact: true }).selectOption("system"); await waitMode("system");
  for (const colorScheme of ["dark", "light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(dark => window.__qaCalls.filter(call => call.command === "set_android_appearance").at(-1)?.args.dark === dark, colorScheme === "dark");
    await assertMatches();
  }
  cases.push("system-mode-follows-changes-and-retains-both-palettes");
  for (const width of [360, 412, 915, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 900 ? 768 : 915 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.screenshot({ path: `${output}/dark-custom.png`, fullPage: true });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/result.json`, JSON.stringify({ cases, errors }, null, 2)); console.log(JSON.stringify({ cases }));
} finally { await browser.close(); }
