import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const python = "C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const run = Date.now(), output = `D:/DevTools/Android/Build/qa/player-page-${run}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000 });
const bytes = (...args) => execFileSync(adb, ["-s", serial, ...args], { timeout: 20000, maxBuffer: 24 * 1024 * 1024 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const media = readFileSync("D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4");
const names = [`GenzoPortraitQA-${run}-13.mp4`, `GenzoPortraitQA-${run}-14.mp4`, `GenzoPortraitQA-${run}-13-alt.mp4`, `GenzoPortraitQA-${run}-OP.mp4`];
let holdInitialProbe = false, releaseInitialProbe;
let stallSecond = false;
let failSecond = false;
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/rule/detail") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end('<div class="road"><a href="/rule/one">第01集</a><a href="/rule/two">第02集</a></div><div class="road"><a href="/rule/one-b">第01集</a><a href="/rule/two-b">第02集</a></div>'); return; }
  if (/^\/rule\/(one|two)(-b)?$/.test(path)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end('<video src="/video.mp4"></video>'); return; }
  if (req.method === "PROPFIND") {
    const item = (href, folder) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${folder ? "<d:collection/>" : ""}</d:resourcetype>${folder ? "" : `<d:getcontentlength>${media.length}</d:getcontentlength>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    res.writeHead(207, { "Content-Type": "application/xml" }); res.end(`<d:multistatus xmlns:d="DAV:">${item("/dav/", true)}${names.map(name => item(`/dav/${name}`, false)).join("")}</d:multistatus>`); return;
  }
  if (holdInitialProbe && req.url.includes(names[0]) && req.headers.range === "bytes=0-0") { holdInitialProbe = false; releaseInitialProbe = () => sendMedia(req,res); return; }
  if (req.url.includes(names[1]) && failSecond) { res.writeHead(503); res.end(); return; }
  if (req.url.includes(names[1]) && stallSecond) { stallSecond = false; setTimeout(() => sendMedia(req, res), 2300); return; }
  sendMedia(req, res);
});
function sendMedia(req, res) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
  res.writeHead(match ? 206 : 200, { "Content-Type": "video/mp4", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(match ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}) });
  res.end(req.method === "HEAD" ? undefined : media.subarray(start, end + 1));
}
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port; command("reverse", `tcp:${port}`, `tcp:${port}`);
let browser, page, info, sourceId, workId, original, seeded, pluginId;
const result = { output, cases: {} };
async function invoke(name, args = {}) {
  let timer;
  try { return await Promise.race([page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`RPC timeout ${name}`)), 15000); })]); }
  finally { clearTimeout(timer); }
}
const native = (name, payload = {}) => invoke("android_native", { command: name, payload });
async function connect() {
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1400);
  const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
  command("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true, timeout: 8000 });
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert.ok(page);
  info = await invoke("get_app_info"); assert.equal(info.dataDirectory, `/data/user/0/${app}`); assert.equal(info.databasePath, `${info.dataDirectory}/genzo.db`);
}
async function wait(read, accept, label, timeout = 30000) {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await read(); if (accept(value)) return value; await delay(200); }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
function dump() { command("shell", "uiautomator", "dump", "/data/local/tmp/genzo-player-page.xml"); return command("shell", "cat", "/data/local/tmp/genzo-player-page.xml"); }
function node(xml, label) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(m => m[0]).find(n => n.includes(`text="${label}"`) || n.includes(`content-desc="${label}"`));
}
function tap(xml, label) {
  const element = node(xml, label); assert.ok(element, label);
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(element); assert.ok(bounds);
  command("shell", "input", "tap", String((Number(bounds[1]) + Number(bounds[3])) >> 1), String((Number(bounds[2]) + Number(bounds[4])) >> 1));
}
function tapPrefix(xml, label) {
  const value = [...xml.matchAll(/<node\b[^>]*>/g)].map(m => m[0]).find(n => n.includes(`text="${label}`)); assert.ok(value, label);
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(value);
  command("shell", "input", "tap", String((Number(bounds[1]) + Number(bounds[3])) >> 1), String((Number(bounds[2]) + Number(bounds[4])) >> 1));
}
function shot(name) { writeFileSync(`${output}/${name}.png`, bytes("exec-out", "screencap", "-p")); }
try {
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); command("shell", "wm", "dismiss-keyguard"); await connect();
  original = await invoke("get_android_playback_preferences"); await invoke("set_android_playback_preferences", { settings: { hardwareDecoding: true, hardwareDecoder: "mediacodec-copy", videoRenderer: "gpu", superResolution: 0 } });
  sourceId = await invoke("add_webdav_source", { input: { name: `QA Portrait ${run}`, endpoint: `http://127.0.0.1:${port}`, directory: "/dav/", username: "qa", password: "own-fixture", kind: "video" } });
  const allFiles = (await wait(() => invoke("list_unassigned_media", { destination: "media" }), items => items.filter(f => f.libraryRootId === sourceId).length === 4, "fixture scan")).filter(f => f.libraryRootId === sourceId);
  const files = names.slice(0, 2).map(name => allFiles.find(file => file.fileName === name));
  const variant = allFiles.find(file => file.fileName === names[2]); assert.ok(variant && files.every(Boolean));
  await wait(() => invoke("list_source_imports"), tasks => !tasks.some(t => t.sourceIds.includes(sourceId) && ["queued", "scanning", "recognizing", "enriching"].includes(t.stage)), "background fixture import");
  const work = await invoke("create_work_from_media", { mediaFileId: files[0].id, selectedMediaIds: allFiles.map(f => f.id), input: { title: `GenzoPortraitQA-${run}`, originalTitle: null, type: "video", description: "Synthetic isolated player fixture", coverPath: null, status: "planned", favorite: false, rating: null, tags: [], notes: "" } });
  workId = work.id;
  writeFileSync(`${output}/seed.json`, JSON.stringify({ app, dataDirectory: info.dataDirectory, workId, mediaIds: files.map(f => f.id), variantMediaId: variant.id, run }));
  await browser.close(); browser = null; command("shell", "am", "force-stop", app);
  // Only this guarded synthetic QA database is copied. Never run against readerqa or the release package.
  writeFileSync(`${output}/genzo.db`, bytes("exec-out", "run-as", app, "cat", "genzo.db"));
  for (const suffix of ["-wal", "-shm"]) { try { writeFileSync(`${output}/genzo.db${suffix}`, bytes("exec-out", "run-as", app, "cat", `genzo.db${suffix}`)); } catch { /* A checkpoint may have removed this QA-only sidecar. */ } }
  execFileSync(python, ["scripts/fixtures/android-player-page-seed.py", output], { encoding: "utf8" }); seeded = JSON.parse(readFileSync(`${output}/seed-result.json`, "utf8"));
  const upload = (host, remote) => { const tmp = `/data/local/tmp/GenzoPortraitQA-${run}-${host.split("/").at(-1)}`; command("push", host, tmp); command("shell", "run-as", app, "cp", tmp, remote); command("shell", "rm", "-f", tmp); };
  command("shell", "run-as", app, "rm", "-f", "genzo.db-wal", "genzo.db-shm"); upload(`${output}/genzo.db`, "genzo.db");
  for (const name of seeded.images) upload(`${output}/${name}`, `covers/${name}`);
  await connect(); result.cases.guardedSyntheticDataOnly = true;
  holdInitialProbe = true;
  const openedAt = Date.now();
  let current = await invoke("open_internal_player", { mediaFileId: files[0].id, restart: true, subtitleId: null });
  result.initialOpenRpcMs = Date.now() - openedAt;
  assert.ok(result.initialOpenRpcMs < 1500, "opening should return before the held WebDAV probe");
  await wait(() => native("playerState"), state => state.sessionId === current.sessionId && state.status === "opening" && !state.engineInitialized, "first WebDAV entry loading shell");
  await wait(async () => !!releaseInitialProbe, Boolean, "WebDAV probe is still held");
  assert.ok(command("shell", "dumpsys", "activity", "activities").split("\n").find(line => line.includes("topResumedActivity"))?.includes("PlayerActivity"));
  shot("initial-loading-inside-player"); releaseInitialProbe(); releaseInitialProbe = null;
  result.cases.initialWebdavOpensPlayerBeforeNetworkProbe = true;
  await wait(() => native("playerState"), s => s.sessionId === current.sessionId && s.status === "playing", "native video");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await wait(async () => dump(), xml => !!node(xml, "第01集 当前选集") && !!node(xml, "第02集"), "portrait episodes");
  await delay(600); shot("portrait"); result.cases.officialEpisode13MapsTo1 = true;
  let xml = dump(); const covers = [...xml.matchAll(/<node\b[^>]*content-desc="[^"]*分集封面"[^>]*>/g)].filter(m => /第0[12]集分集封面/.test(m[0])).map(m => /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(m[0]).slice(1).map(Number));
  assert.ok(xml.indexOf('content-desc="第01集 当前选集"') < xml.indexOf("未匹配分集的文件"));
  if (!xml.includes(names[3])) {
    const size=/(?:Physical|Override) size: (\d+)x(\d+)/.exec(command("shell","wm","size"));
    command("shell","input","swipe",String(Number(size[1])>>1),String(Math.round(Number(size[2])*.88)),String(Number(size[1])>>1),String(Math.round(Number(size[2])*.55)),"300");
    xml=await wait(async()=>dump(),value=>value.includes(names[3]),"unmatched file visible after scrolling");
    shot("unmatched-bottom");
  }
  assert.ok(xml.includes(names[3])); result.cases.officialEpisodesPrecedeUnmatchedFiles = true;
  assert.ok(xml.includes(`GenzoPortraitQA-${run} · 第01集`));
  assert.ok(Number(/bounds="\[\d+,(\d+)\]/.exec(node(xml,"返回"))[1]) <= 32, "header should be flush with the video top");
  result.cases.headerHasEpisodeWithoutTopGap = true;
  assert.equal(covers.length, 2); writeFileSync(`${output}/cover-bounds.json`, JSON.stringify(covers));
  const fraction = Number(execFileSync(python, ["-c", "from PIL import Image;import json,sys;im=Image.open(sys.argv[1]).convert('RGB'); boxes=json.load(open(sys.argv[2])); print(min(sum(max(p)-min(p)>70 for p in im.crop(b).resize((80,45)).getdata())/3600 for b in boxes))", `${output}/portrait.png`, `${output}/cover-bounds.json`], { encoding: "utf8" }));
  assert.ok(fraction > .4, `real episode bitmap missing: ${fraction}`); result.cases.actualCachedEpisodeStills = true;
  tapPrefix(dump(), "播放文件");
  xml = await wait(async () => dump(), xml => xml.includes("选择本集文件") && xml.includes(names[2]), "same episode file picker"); shot("file-choices");
  assert.ok(!xml.includes(names[1]), "another episode leaked into file choices");
  tap(xml, names[2]);
  current = await wait(() => native("playerState"), state => state.mediaFileId === variant.id && state.status === "playing", "variant file identity");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await wait(async () => dump(), xml => !!node(xml, "第01集 当前选集"), "variant keeps official episode");
  tapPrefix(dump(), "播放文件"); tap(dump(), names[0]);
  current = await wait(() => native("playerState"), state => state.mediaFileId === files[0].id && state.status === "playing", "original file identity");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  result.cases.sameEpisodeFilePickerSwitchesStableMediaId = true;
  const dimensions = /(?:Physical|Override) size: (\d+)x(\d+)/.exec(command("shell", "wm", "size")); const width = Number(dimensions[1]);
  for (let i = 0; i < 2; i++) { command("shell", "input", "tap", String(width >> 1), String(Math.round(width * 9 / 32))); await delay(300); }
  tap(dump(), "更多播放设置"); await delay(250); command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(250);
  tap(dump(), "评论"); await delay(350); tap(dump(), "选集"); await delay(350);
  result.cases.interactionTransitionsKeepLatestTab = true;
  xml = dump();
  tap(xml, "更多播放设置"); xml = dump(); shot("more-menu");
  for (const label of ["倍速", "超分辨率", "音轨", "字幕", "选择外挂字幕", "字幕偏移", "视频详情", "开源说明"]) assert.ok(xml.includes(label), label);
  for (const label of ["远程投屏", "一起看", "弹幕设置", "定时关闭", "截取当前画面"]) assert.ok(!xml.includes(label), label);
  result.cases.onlyImplementedMenuActions = true;
  tapPrefix(xml, "倍速"); tap(dump(), "1.5×"); await wait(() => native("playerState"), state => state.rate === 1.5, "speed menu applies"); result.cases.actualSpeedMenu = true;
  tap(dump(), "更多播放设置"); tapPrefix(dump(), "超分辨率"); tap(dump(), "流畅档");
  await wait(() => native("playerState"), s => s.status === "paused" && s.superResolution === 1 && s.shaderCount === 6, "shader menu selection");
  // A paused frame can retain the prior GPU statistics. Verify an actual new frame,
  // then pause again; selecting a preset itself must not reopen the episode.
  await native("playerControl", { action: "play" });
  await wait(() => native("playerState"), s => s.status === "playing" && s.shaderPasses.some(pass => pass.includes("Anime4K")), "real shader frame");
  await native("playerControl", { action: "pause" });
  assert.ok(node(dump(), "第01集 当前选集")); result.cases.actualSuperResolutionKeepsEpisodePanel = true;
  await native("playerControl", { action: "superResolution", value: 0 });
  xml = dump(); tap(xml, "第02集");
  await wait(() => native("playerState"), s => s.mediaFileId === files[1].id && s.status === "playing", "actual episode switch"); result.cases.nextEpisodeUsesStableMediaId = true;
  current = await native("playerState"); await native("playerControl", { action: "pause", sessionId: current.sessionId }); await native("playerControl", { action: "landscape", sessionId: current.sessionId }); await delay(700); shot("landscape");
  assert.ok(!dump().includes('text="选集"'));
  tap(dump(), "更多播放设置"); xml = dump();
  const scrollNode = [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0]).find(value => value.includes('class="android.widget.ScrollView"'));
  assert.ok(scrollNode, "landscape menu is scrollable"); const scrollBounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(scrollNode).slice(1).map(Number);
  const scrollHeight = scrollBounds[3] - scrollBounds[1];
  command("shell", "input", "swipe", String((scrollBounds[0] + scrollBounds[2]) >> 1), String(Math.round(scrollBounds[1] + scrollHeight * .75)), String((scrollBounds[0] + scrollBounds[2]) >> 1), String(Math.round(scrollBounds[1] + scrollHeight * .3)), "350");
  await delay(300); xml = dump(); assert.ok(node(xml, "开源说明")); shot("landscape-menu"); result.cases.landscapeMenuScrollsWithoutClipping = true;
  command("shell", "input", "keyevent", "KEYCODE_BACK"); command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(600);
  await wait(async () => dump(), xml => !!node(xml, "第02集 当前选集"), "fullscreen returns without closing"); assert.equal((await native("playerState")).sessionId, current.sessionId); result.cases.fullscreenBackKeepsSessionAndEpisode = true;
  tap(dump(), "评论");
  xml = await wait(async () => dump(), xml => xml.includes("第02集 · Bangumi 分集讨论") && !xml.includes("正在读取 Bangumi 本集讨论"), "Bangumi comments", 45000); shot("comments");
  assert.ok(!xml.includes("读取失败"), "live Bangumi comments failed"); assert.ok(xml.includes("Bangumi")); result.cases.liveCurrentEpisodeDiscussion = true;
  const assets = await wait(async () => {
    try { return command("shell", "run-as", app, "ls", "covers/comment-discussions").trim().split("\n").filter(name => name.endsWith("-comment.jpg")); }
    catch { return []; }
  }, files => files.length > 0, "real discussion avatar cache", 30000);
  assert.ok(xml.includes("头像")); await delay(500); shot("comments-with-avatars");
  result.cases.realDiscussionImagesUseBoundedPrivateCache = true;
  tap(xml, "选集");
  await native("playerControl", { action: "close", sessionId: current.sessionId }); result.cases.closeReturnsToLibrary = true;
  current = await invoke("open_internal_player", { mediaFileId: files[0].id, restart: true, subtitleId: null });
  await wait(() => native("playerState"), s => s.sessionId === current.sessionId && s.status === "playing", "cancellation initial video");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await wait(async () => dump(), xml => !!node(xml, "第02集"), "cancellation episodes");
  stallSecond = true; tap(dump(), "第02集");
  await wait(() => native("playerState"), s => s.sessionId !== current.sessionId && s.status === "opening", "next episode loading shell");
  command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(2800);
  assert.equal((await native("playerState")).status, "closed");
  assert.ok(command("shell", "dumpsys", "activity", "activities").split("\n").find(line => line.includes("topResumedActivity"))?.includes("MainActivity")); result.cases.cancelSlowEpisodeDoesNotReopenPlayer = true;
  current = await invoke("open_internal_player", { mediaFileId: files[0].id, restart: true, subtitleId: null });
  await wait(() => native("playerState"), s => s.sessionId === current.sessionId && s.status === "playing", "source failure initial video");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await wait(async () => dump(), xml => !!node(xml, "第02集"), "source failure episodes");
  failSecond = true; tap(dump(), "第02集");
  const failed = await wait(() => native("playerState"), s => s.sessionId !== current.sessionId && s.error?.code === "source_offline", "preflight failure displayed inside player");
  assert.equal(failed.engineInitialized, false); shot("source-failure"); failSecond = false;
  await native("playerControl", { action: "close", sessionId: failed.sessionId }); result.cases.preflightFailureDoesNotLeaveEndlessSpinner = true;
  const beforePreview = (await invoke("get_playback_progress")).items.length;
  pluginId = await invoke("import_rule_plugin", { definition: { api: "8", name: `QA Portrait ${run}`, version: "1", baseURL: `http://127.0.0.1:${port}`, searchURL: `http://127.0.0.1:${port}/rule/search?q=@keyword`, searchList: "//a", searchName: ".", searchResult: ".", chapterRoads: "//div[@class='road']", chapterResult: "//a", useWebview: true, useLegacyParser: false }, origin: null });
  current = await invoke("preview_rule_episode", { pluginId, source: `http://127.0.0.1:${port}/rule/detail`, roadIndex: 0, episodeIndex: 0 });
  await wait(() => native("playerState"), s => s.sessionId === current.sessionId && s.status === "playing", "rule preview player");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await wait(async () => dump(), xml => !!node(xml, "第01集 当前选集") && !!node(xml, "第02集"), "rule episode panel");
  tapPrefix(dump(), "播放线路");
  xml = await wait(async () => dump(), xml => xml.includes("选择播放线路") && xml.includes("线路2"), "current source roads only"); shot("rule-roads");
  assert.ok(xml.includes("2 集") && !xml.includes("选择本集文件")); tap(xml, "线路2");
  await wait(async () => dump(), xml => xml.includes("播放线路  ·  线路2"), "selected road label");
  result.cases.currentRuleSourceRoadPicker = true;
  tap(dump(), "第02集"); await wait(() => native("playerState"), s => s.sessionId !== current.sessionId && s.status === "playing", "rule page switches episode");
  current = await native("playerState"); await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await wait(async () => dump(), xml => !!node(xml, "第02集 当前选集"), "rule current selection");
  tap(dump(), "评论"); assert.ok((await wait(async () => dump(), xml => xml.includes("尚未关联 Bangumi"), "unbound rule comments")).includes("尚未关联 Bangumi"));
  await native("playerControl", { action: "close", sessionId: current.sessionId });
  assert.equal((await invoke("get_playback_progress")).items.length, beforePreview); result.cases.ruleEpisodeSwitchAndUnboundPreviewPrivacy = true;
  console.log(JSON.stringify(result));
} catch (error) { result.error = String(error); shot("failure"); throw error; }
finally {
  releaseInitialProbe?.();
  if (browser && info?.dataDirectory === `/data/user/0/${app}`) {
    await native("playerControl", { action: "close" }).catch(() => {});
    if (original) await invoke("set_android_playback_preferences", { settings: original }).catch(() => {});
    if (workId) await invoke("delete_work", { id: workId }).catch(() => {});
    if (pluginId) await invoke("remove_rule_plugin", { id: pluginId }).catch(() => {});
    if (sourceId) await invoke("remove_webdav_source", { id: sourceId }).catch(() => {});
    for (const name of seeded?.images ?? []) command("shell", "run-as", app, "rm", "-f", `covers/${name}`);
  }
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); await browser?.close();
  command("shell", "rm", "-f", "/data/local/tmp/genzo-player-page.xml"); command("forward", "--remove", "tcp:9346"); command("reverse", "--remove", `tcp:${port}`);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
