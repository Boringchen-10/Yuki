import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const app = "com.genzo.android.organizeqa";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const serial = process.env.GENZO_ANDROID_SERIAL || "3B164M00Z0500000";
const namespace = `chapter-comments-${Date.now()}`;
const output = `D:/DevTools/Android/Build/qa/${namespace}`;
const xmlPath = `/data/local/tmp/genzo-${namespace}.xml`;
const chapters = [
  { id: "00000000-0000-4000-8000-000000000001", title: "合成漫画 · 甲话", total: 75 },
  { id: "00000000-0000-4000-8000-000000000002", title: "合成漫画 · 乙话", total: 0 },
  { id: "00000000-0000-4000-8000-000000000003", title: "合成漫画 · 丙话", total: 1 },
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function png() {
  const width = 600, height = 900, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 3 + 1) + 1 + x * 3;
    raw[at] = 45 + Math.floor(y / 90) * 12; raw[at + 1] = x < width / 2 ? 150 : 95; raw[at + 2] = 125;
  }
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), hash = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); hash.writeUInt32BE(crc(Buffer.concat([name, bytes])));
    return Buffer.concat([size, name, bytes, hash]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function createFixture() {
  const image = png(), events = [], progress = new Map(), timers = new Set();
  let base, failAppend = true, delayThird = true, pendingThird = null;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const prefix = `/${namespace}/`;
    const send = (status, value) => {
      if (response.destroyed) return;
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value));
    };
    if (!path.startsWith(prefix)) { send(404, { error: "fixture session required" }); return; }
    const route = path.slice(prefix.length).split("/");
    const chapter = chapters.find(item => item.id === route[1]);
    if (request.method === "POST") {
      const parts = []; for await (const part of request) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
      if (route.length === 3 && route[0] === "chapter" && chapter && route[2] === "progress") {
        progress.set(chapter.id, body); events.push({ type: "progress", chapter: chapter.id, body, at: Date.now() }); send(200, {}); return;
      }
      if (route.length === 1 && route[0] === "close") { events.push({ type: "close", at: Date.now() }); send(200, {}); return; }
      send(404, { error: "unknown fixture write" }); return;
    }
    if (route[0] === "entries" && route.length === 2) {
      const offset = Number(route[1]);
      send(200, { entries: chapters.slice(offset).map((item, order) => ({ id: item.id, title: item.title, order: order + offset, count: 12 })), total: chapters.length, offset, group: "default", groups: [], stale: false }); return;
    }
    if (route[0] !== "chapter" || !chapter) { send(404, { error: "unknown synthetic chapter" }); return; }
    if (route.length === 2) {
      events.push({ type: "manifest", chapter: chapter.id, at: Date.now() });
      send(200, { kind: "comic", entryId: chapter.id, title: chapter.title, offline: false,
        pages: Array.from({ length: 12 }, (_, index) => `${base}chapter/${chapter.id}/page/${index}`),
        cacheKeys: Array.from({ length: 12 }, (_, index) => createHash("sha256").update(`${namespace}/${chapter.id}/${index}`).digest("hex")),
        location: progress.get(chapter.id) || { pageIndex: chapter === chapters[0] ? 2 : 0, offset: 0 } }); return;
    }
    if (route.length === 4 && route[2] === "page") {
      events.push({ type: "image", chapter: chapter.id, index: Number(route[3]), at: Date.now() });
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.length }); response.end(image); return;
    }
    if (route.length === 4 && route[2] === "comments") {
      const offset = Number(route[3]);
      const status = chapter === chapters[0] && offset === 30 && failAppend ? 503 : 200;
      if (status === 503) failAppend = false;
      const items = status === 200 ? Array.from({ length: Math.max(0, Math.min(30, chapter.total - offset)) }, (_, index) => ({
        id: `${chapter.id}-${offset + index + 1}`, createAt: "2026-10-13", userId: `qa-${index}`, userName: `合成用户${offset + index + 1}`,
        userAvatar: "", comment: `合成${chapter === chapters[0] ? "甲" : "丙"}评论${String(offset + index + 1).padStart(2, "0")}`,
      })) : [];
      const event = { type: "comments", chapter: chapter.id, offset, status, count: items.length, total: chapter.total, at: Date.now() };
      events.push(event);
      const finish = () => { event.responseAt = Date.now(); event.cancelled = response.destroyed; send(status, status === 200 ? { items, total: chapter.total, offset, limit: 30 } : { error: "synthetic append failure" }); };
      if (chapter === chapters[2] && delayThird) {
        delayThird = false;
        const timer = setTimeout(() => pendingThird?.(), 30000); timers.add(timer);
        pendingThird = () => { clearTimeout(timer); timers.delete(timer); pendingThird = null; finish(); };
      } else finish();
      return;
    }
    send(404, { error: "unknown fixture resource" });
  });
  return { server, events, progress, timers, releaseThird() { assert.ok(pendingThird, "third reply must still be pending"); pendingThird(); }, async start() {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}/${namespace}/`; return base;
  } };
}

async function until(read, accept, label, milliseconds = 10000) {
  const end = Date.now() + milliseconds; let value;
  while (Date.now() < end) { value = await read(); if (accept(value)) return value; await delay(100); }
  throw new Error(`${label}: ${typeof value === "string" ? value.slice(0, 350) : JSON.stringify(value)}`);
}
function nodes(xml) { return [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0]); }
function node(xml, label, description = false) { return nodes(xml).find(item => item.includes(`${description ? "content-desc" : "text"}="${label}"`)); }
function point(element) {
  assert.ok(element, "native UI node must exist");
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(element); assert.ok(bounds);
  return [Math.round((Number(bounds[1]) + Number(bounds[3])) / 2), Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)];
}
function tapPoint(coordinates) { command("shell", "input", "tap", ...coordinates.map(String)); }
function tap(xml, label, description = false) { tapPoint(point(node(xml, label, description))); }
function position(xml) { return nodes(xml).map(item => /text="(\d+)"/.exec(item)?.[1]).filter(Boolean); }

async function deviceTest() {
  const fixture = createFixture(), result = { app, serial, output, cases: {}, events: fixture.events };
  let browser, page, forward, reverse, guarded = false, opened = false, instrumentation, instrumentationDone;
  let instrumentationLog = "";
  const invoke = (commandName, args = {}) => page.evaluate(({ commandName, args }) => window.__TAURI_INTERNALS__.invoke(commandName, args), { commandName, args });
  const dump = () => { command("shell", "uiautomator", "dump", xmlPath); return command("shell", "cat", xmlPath); };
  const ownsReader = () => command("shell", "dumpsys", "activity", "activities").split("\n").some(line => line.includes("topResumedActivity") && line.includes(app) && line.includes("ReaderActivity"));
  const shot = name => {
    assert.ok(guarded && opened && ownsReader(), "screenshots are restricted to the synthetic QA reader");
    writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { timeout: 20000, maxBuffer: 24 * 1024 * 1024 }));
  };
  const chrome = async title => {
    let xml = dump();
    if (!node(xml, "本话评论", true)) {
      const dimensions = /(?:Physical|Override) size: (\d+)x(\d+)/.exec(command("shell", "wm", "size")); assert.ok(dimensions);
      tapPoint([Math.round(Number(dimensions[1]) / 2), Math.round(Number(dimensions[2]) / 2)]);
    }
    return until(async () => dump(), value => !!node(value, "本话评论", true) && value.includes(title), "reader toolbar");
  };
  const comments = chapter => fixture.events.filter(event => event.type === "comments" && event.chapter === chapter.id);
  try {
    command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1000);
    const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
    forward = Number(command("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`).trim()); assert.ok(forward > 0);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${forward}`, { noDefaults: true, timeout: 10000 });
    page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes("tauri.localhost")); assert.ok(page);
    const info = await invoke("get_app_info");
    assert.equal(info.dataDirectory, `/data/user/0/${app}`); assert.equal(info.databasePath, `${info.dataDirectory}/genzo.db`);
    guarded = true; mkdirSync(output, { recursive: true }); result.cases.strictIsolatedPackageGuard = true;
    const base = await fixture.start(); reverse = fixture.server.address().port; command("reverse", `tcp:${reverse}`, `tcp:${reverse}`);
    instrumentation = spawn(adb, ["-s", serial, "shell", "am", "instrument", "-w", "-r",
      "-e", "class", "com.genzo.android.ReaderCommentsLaunchTest", "-e", "baseUrl", base,
      "-e", "sessionId", namespace, "-e", "entryId", chapters[0].id,
      `${app}.test/androidx.test.runner.AndroidJUnitRunner`], { stdio: ["ignore", "pipe", "pipe"] });
    instrumentation.stdout.on("data", bytes => { instrumentationLog += bytes.toString(); });
    instrumentation.stderr.on("data", bytes => { instrumentationLog += bytes.toString(); });
    instrumentationDone = new Promise(resolve => instrumentation.once("close", code => resolve(code)));
    result.launchMethod = "separate instrumentation APK, own target context";
    opened = true;
    await until(() => fixture.events, events => events.some(event => event.type === "image" && event.chapter === chapters[0].id), "synthetic comic image");
    let xml = await chrome(chapters[0].title); await delay(700);
    xml = dump(); const beforePosition = position(xml); assert.equal(beforePosition.at(-1), "12");
    const firstManifestCount = fixture.events.filter(event => event.type === "manifest" && event.chapter === chapters[0].id).length;
    tap(xml, "本话评论", true);
    xml = await until(async () => dump(), value => value.includes("75 条评论") && value.includes("合成甲评论01"), "first chapter comments");
    assert.ok(xml.includes(chapters[0].title)); assert.ok(xml.includes("来源暂未提供本话热度"));
    assert.deepEqual(comments(chapters[0]).map(({ offset, count }) => ({ offset, count })), [{ offset: 0, count: 30 }]);
    shot("first-30"); result.cases.firstPageTitleTotalAndHonestHeat = true;
    tap(xml, "加载更多评论");
    xml = await until(async () => dump(), value => value.includes("本话评论读取失败") && value.includes("合成甲评论01"), "append failure retains comments");
    assert.ok(xml.includes("75 条评论")); assert.equal(comments(chapters[0]).at(-1).status, 503); shot("append-failure");
    tap(xml, "重试");
    xml = await until(async () => dump(), value => !value.includes("本话评论读取失败") && !!node(value, "加载更多评论") && comments(chapters[0]).filter(event => event.offset === 30).length === 2, "retry same offset");
    assert.deepEqual(comments(chapters[0]).map(event => event.offset), [0, 30, 30]); result.cases.appendFailureKeepsItemsAndRetriesSamePage = true;
    tap(xml, "加载更多评论");
    xml = await until(async () => dump(), value => value.includes("75 条评论") && !node(value, "加载更多评论") && comments(chapters[0]).at(-1)?.offset === 60, "final offset 60 page");
    assert.equal(comments(chapters[0]).at(-1).count, 15); shot("complete-75"); result.cases.sourcePagination30And60 = true;
    tap(xml, "关闭"); xml = await chrome(chapters[0].title);
    assert.deepEqual(position(xml), beforePosition);
    assert.equal(fixture.events.filter(event => event.type === "manifest" && event.chapter === chapters[0].id).length, firstManifestCount);
    const beforeReopen = comments(chapters[0]).length;
    tap(xml, "本话评论", true);
    xml = await until(async () => dump(), value => value.includes("75 条评论") && !node(value, "加载更多评论"), "cached chapter reopen");
    await delay(300); assert.equal(comments(chapters[0]).length, beforeReopen); result.cases.reopenUsesSessionCache = true;
    tap(xml, "关闭"); xml = await chrome(chapters[0].title); assert.deepEqual(position(xml), beforePosition); result.cases.closePreservesChapterAndReadingPosition = true;
    tap(xml, "下一话", true); xml = await chrome(chapters[1].title);
    tap(xml, "本话评论", true);
    xml = await until(async () => dump(), value => value.includes("0 条评论") && value.includes("本话暂无评论"), "independent empty next chapter");
    assert.ok(xml.includes(chapters[1].title)); assert.ok(!xml.includes("合成甲评论")); assert.deepEqual(comments(chapters[1]).map(event => event.offset), [0]);
    shot("next-chapter-empty"); result.cases.nextChapterHasIndependentEmptyFeed = true;
    tap(xml, "关闭"); xml = await chrome(chapters[1].title);
    tap(xml, "下一话", true); xml = await chrome(chapters[2].title); tap(xml, "本话评论", true);
    await until(() => comments(chapters[2]), events => events.length === 1, "delayed third chapter request");
    xml = await until(async () => dump(), value => value.includes("正在读取本话评论") && !!node(value, "关闭"), "pending third chapter panel");
    tap(xml, "关闭"); xml = await chrome(chapters[2].title);
    tap(xml, "目录", true);
    const returnCatalogue = await until(async () => dump(), value => value.includes("章节目录") && !!node(value, chapters[1].title), "return catalogue");
    tap(returnCatalogue, chapters[1].title); xml = await chrome(chapters[1].title);
    const newPanelAt = Date.now(); tap(xml, "本话评论", true);
    xml = await until(async () => dump(), value => value.includes("0 条评论") && value.includes(chapters[1].title), "new panel while old response is pending");
    fixture.releaseThird();
    await until(() => comments(chapters[2])[0], event => !!event?.responseAt, "late response attempt", 5000);
    assert.ok(comments(chapters[2])[0].responseAt > newPanelAt, "new chapter panel must be open before the delayed response completes");
    xml = dump(); assert.ok(xml.includes("本话暂无评论") && xml.includes(chapters[1].title)); assert.ok(!xml.includes("合成丙评论"));
    assert.equal(comments(chapters[1]).length, 1); shot("late-result-isolated"); result.cases.dismissedLateResultCannotReplaceNewPanel = true;
    tap(xml, "关闭"); xml = await chrome(chapters[1].title); tap(xml, "返回", true);
    await until(() => fixture.events, events => events.some(event => event.type === "close"), "synthetic reader close"); opened = false;
    const firstProgress = fixture.events.filter(event => event.type === "progress" && event.chapter === chapters[0].id).at(-1);
    assert.ok(firstProgress); assert.equal(firstProgress.body.pageIndex + 1, Number(beforePosition.at(-2)));
    result.cases.progressRemainsScopedToSyntheticSession = true; result.passed = true;
  } catch (error) {
    result.error = String(error);
    if (guarded && opened && ownsReader()) shot("failure");
    throw error;
  } finally {
    if (guarded && opened && ownsReader()) {
      command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(250);
      if (ownsReader()) { command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(500); }
    }
    if (instrumentation && guarded) {
      command("shell", "run-as", app, "touch", `cache/reader-comments-${namespace}.done`);
      let exitTimer;
      const exitCode = await Promise.race([instrumentationDone, new Promise(resolve => { exitTimer = setTimeout(() => resolve("timeout"), 15000); })]);
      clearTimeout(exitTimer);
      writeFileSync(`${output}/instrumentation.txt`, instrumentationLog);
      result.instrumentation = { exitCode, passed: exitCode === 0 && /OK \(1 test\)/.test(instrumentationLog) };
      if (exitCode === "timeout") { instrumentation.kill(); result.passed = false; }
      if (!result.instrumentation.passed) result.passed = false;
    }
    await browser?.close().catch(() => {});
    for (const timer of fixture.timers) clearTimeout(timer);
    fixture.server.closeAllConnections();
    if (fixture.server.listening) await new Promise(resolve => fixture.server.close(resolve));
    if (forward) command("forward", "--remove", `tcp:${forward}`);
    if (reverse) command("reverse", "--remove", `tcp:${reverse}`);
    if (guarded) { command("shell", "rm", "-f", xmlPath); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); }
  }
  assert.equal(result.instrumentation?.passed, true, instrumentationLog);
  console.log(JSON.stringify({ output, passed: result.passed, cases: result.cases }));
}

async function selfTest() {
  const fixture = createFixture(), base = await fixture.start();
  try {
    const get = path => fetch(base + path);
    assert.equal((await (await get(`chapter/${chapters[0].id}`)).json()).pages.length, 12);
    assert.equal((await (await get("entries/0")).json()).entries.length, 3);
    assert.equal((await get(`chapter/${chapters[0].id}/page/2`)).headers.get("content-type"), "image/png");
    for (const [offset, status, count] of [[0, 200, 30], [30, 503, 0], [30, 200, 30], [60, 200, 15]]) {
      const response = await get(`chapter/${chapters[0].id}/comments/${offset}`); assert.equal(response.status, status);
      if (status === 200) assert.equal((await response.json()).items.length, count);
    }
    assert.equal((await (await get(`chapter/${chapters[1].id}/comments/0`)).json()).total, 0);
    await fetch(`${base}chapter/${chapters[0].id}/progress`, { method: "POST", body: JSON.stringify({ pageIndex: 2, offset: 0 }) });
    assert.equal(fixture.progress.get(chapters[0].id).pageIndex, 2);
    console.log(JSON.stringify({ passed: true, scope: "local HTTP fixture only; no ADB or device operations" }));
  } finally { for (const timer of fixture.timers) clearTimeout(timer); fixture.server.closeAllConnections(); await new Promise(resolve => fixture.server.close(resolve)); }
}

if (process.argv.includes("--self-test")) await selfTest(); else await deviceTest();
