import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const baseline = process.argv.includes("--baseline");
const output = `D:/DevTools/Android/Build/qa/detail-glass-motion-20261014/${baseline ? "before" : "after"}`;
mkdirSync(output, { recursive: true });
await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"', __GENZO_ANDROID__: "true" }, esbuild: { jsx: "automatic" }, build: { outDir: output + "/fixture", lib: { entry: "scripts/fixtures/detail-unification.tsx", name: "DetailFixture", formats: ["iife"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, reducedMotion: "no-preference" });
const errors = [], cases = [], samples = [];
page.on("pageerror", error => errors.push(String(error)));
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(output + "/fixture/fixture.css", "utf8") });
  await page.evaluate(() => {
    window.__motions = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = update => {
      const sample = {};
      const rect = () => document.querySelector('.gz-detail-poster')?.getBoundingClientRect().toJSON();
      const transition = start(update);
      transition.ready.then(() => {
        sample.kind = document.documentElement.dataset.trans;
        sample.ready = rect();
        sample.heroAnimation = document.querySelector('.gz-detail-poster')?.closest('section')?.getAnimations().map(animation => animation.animationName);
        const cover = document.querySelector('[data-cover-id][style*="view-transition"], [data-explore-cover-id][style*="view-transition"]');
        sample.duration = cover ? getComputedStyle(document.documentElement, `::view-transition-group(${getComputedStyle(cover).viewTransitionName})`).animationDuration : null;
      }, () => { sample.skipped = true; });
      transition.finished.then(() => { sample.finished = rect(); window.__motions.push(sample); }, () => {});
      return transition;
    };
  });
  await page.addScriptTag({ content: readFileSync(output + "/fixture/fixture.js", "utf8") });
  const settle = () => page.waitForFunction(() => !document.documentElement.dataset.trans);
  await page.locator('.gz-cover').first().click();
  await page.locator('.gz-shared-anime-hero').waitFor();
  await settle();
  await page.waitForTimeout(80);
  const first = await page.evaluate(() => window.__motions.find(sample => sample.kind === 'morph'));
  samples.push(first);
  if (!baseline) {
    assert.deepEqual(first.heroAnimation, [], 'hero stays stationary during cover morph');
    assert.ok(parseFloat(first.duration) >= .5, 'slower shared cover travel');
    assert.ok(Math.abs(first.ready.y - first.finished.y) < .75, 'no landing jump');
    assert.ok(Math.abs(first.ready.height - first.finished.height) < .75, 'poster size is stable at snapshot');
    assert.equal(await page.locator('.gz-shared-anime-hero').evaluate(node => node.getAnimations().length), 0, 'cleanup does not restart a hero entrance');
    assert.ok(Math.abs(first.finished.y - (await page.locator('.gz-detail-poster').boundingBox()).y) < .75, 'no movement after transition cleanup');
  }
  cases.push('animated discovery cover lands at its final size and position');
  for (const theme of ['light', 'dark']) {
    await page.locator('.android-app').evaluate((node, theme) => node.dataset.theme = theme, theme);
    const glass = await page.locator('.gz-subject-backdrop').evaluate(node => ({
      filter: getComputedStyle(node, '::before').backdropFilter,
      mask: getComputedStyle(node).maskImage,
      fade: getComputedStyle(node, '::after').backgroundImage,
      bottom: getComputedStyle(document.querySelector('.gz-tabbar'), '::before').backgroundImage,
    }));
    if (!baseline) {
      assert.match(glass.filter, /blur\(.*saturate\(/);
      assert.match(glass.mask, /linear-gradient/);
      assert.match(glass.bottom, /linear-gradient/);
    }
    samples.push({ theme, glass });
    await page.screenshot({ path: `${output}/anime-${theme}.png` });
  }
  await page.getByRole('button', { name: '返回发现', exact: true }).click(); await settle();
  for (const [tab, title] of [['漫画', '未入库漫画'], ['轻小说', '未入库轻小说']]) {
    await page.getByRole('tab', { name: tab, exact: true }).click(); await settle();
    await page.getByText(title, { exact: true }).click(); await settle();
    const backgroundCount = await page.locator('.gz-shared-book-hero .gz-subject-backdrop').count();
    if (!baseline) assert.equal(backgroundCount, 0);
    samples.push({ tab, backgroundCount });
    await page.screenshot({ path: `${output}/${tab === '漫画' ? 'comic' : 'novel'}.png` });
    await page.getByRole('button', { name: '返回发现', exact: true }).click(); await settle();
  }
  await page.evaluate(() => window.__goto('detail/book')); await page.locator('.gz-shared-book-hero').waitFor(); await settle();
  if (!baseline) assert.equal(await page.locator('.gz-shared-book-hero .gz-subject-backdrop').count(), 0);
  cases.push('comic and novel discovery plus saved bookshelf have no background image');
  await page.evaluate(() => window.__goto('library')); await settle();
  await page.locator('[data-cover-id="local"]').first().click(); await page.locator('.gz-shared-anime-hero').waitFor(); await settle();
  const saved = await page.evaluate(() => window.__motions.filter(sample => sample.kind === 'morph').at(-1));
  samples.push({ saved });
  if (!baseline) {
    assert.ok(Math.abs(saved.ready.y - saved.finished.y) < .75);
    assert.ok(Math.abs(saved.ready.height - saved.finished.height) < .75);
  }
  const layouts = [];
  for (const [width, height] of [[360, 800], [412, 915], [915, 412], [1024, 640], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const geometry = await page.evaluate(() => {
      const info = document.querySelector('.gz-subject-stats').getBoundingClientRect(), cover = document.querySelector('.gz-detail-poster').getBoundingClientRect(), nav = document.querySelector('.gz-tabbar').getBoundingClientRect();
      return { info: info.toJSON(), cover: cover.toJSON(), nav: nav.toJSON() };
    });
    assert.ok(geometry.cover.right <= geometry.info.left && geometry.nav.bottom <= height + 1);
    layouts.push({ width, height });
  }
  await page.setViewportSize({ width: 412, height: 915 });
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => window.__goto('library')); await settle();
    await page.locator('[data-cover-id="local"]').first().click();
    await page.waitForFunction(() => document.documentElement.dataset.trans === 'morph');
    await page.evaluate(() => window.__genzoBack()); await settle();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[style*="view-transition-name"]').count(), 0);
  }
  cases.push('rapid system back cancels cover motion and clears transition names');
  await page.evaluate(() => { window.__goto('library'); window.__goto('home'); }); await settle();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const count = await page.evaluate(() => window.__motions.length);
  await page.evaluate(() => window.__goto('detail/local')); await page.locator('.gz-shared-anime-hero').waitFor();
  assert.equal(await page.evaluate(() => window.__motions.length), count, 'reduced motion skips snapshots');
  assert.equal(await page.locator('[style*="view-transition-name"]').count(), 0);
  cases.push('six viewports and reduced motion');
  assert.deepEqual(errors, []);
  const result = { baseline, cases, samples, layouts, errors };
  writeFileSync(output + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
