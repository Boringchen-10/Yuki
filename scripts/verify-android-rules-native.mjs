import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium } from "playwright-core";

// All writes are restricted to our isolated QA package and synthetic sources.
// The normal app, readerqa, user media, user servers and credentials are untouched.
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const run = Date.now(), prefix = `QA Rules ${run}`;
const output = `D:/DevTools/Android/Build/qa/rules-native-${run}`;
const mp4 = readFileSync("D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4");
const hls = "D:/DevTools/Android/Build/qa/kazumi-rules-20261010/hls";
const manifest = readFileSync(`${hls}/media.m3u8`, "utf8");
const cookieName = `genzo_rules_qa_${run}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000 });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024, timeout: 20000 }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { app, serial, output, cases: {}, snapshots: {} };
const requests = [], installed = [], publicInstalled = [];
let browser, page, base, signedGeneration = 1;
let offlineSearch = false, offlineChapters = false;
const definitions = new Map();
const json = (response, value, code = 200) => { response.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
const html = (response, content, code = 200) => { response.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); response.end(`<!doctype html><meta charset="utf-8">${content}`); };
const searchHtml = () => `<div class="result"><a class="title" href="/html/detail"><span>受控视频甲</span></a></div><div class="result"><a class="title" href="/html/detail2"><span>受控视频乙</span></a></div><div class="result"><a class="title" href="javascript:alert(1)"><span>无效链接</span></a></div>`;
const chapterHtml = () => `<div class="road"><a href="/play/video">第13集</a><a href="/play/fetch">第14集</a></div><div class="road"><a href="/play/legacy">第15集</a><a href="javascript:alert(1)">无效链接</a></div><div class="road"><a href="/play/xhr">第16集</a></div>`;
const mediaPath = path => path.startsWith("/media/");
function sendMedia(request, response, bytes, type) {
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  let start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : bytes.length - 1;
  if (start >= bytes.length || end < start) { response.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }); response.end(); return; }
  end = Math.min(end, bytes.length - 1);
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
  response.writeHead(range ? 206 : 200, headers);
  response.end(request.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 100000) throw new Error("fixture body too large"); }
    const cookie = request.headers.cookie?.includes(`${cookieName}=yes`) ?? false;
    const pathCookie = request.headers.cookie?.includes(`${cookieName}_path=yes`) ?? false;
    requests.push({ method: request.method, path, query: Object.fromEntries(url.searchParams), body, cookie, pathCookie, referer: request.headers.referer ?? null, userAgent: request.headers["user-agent"] ?? null, range: request.headers.range ?? null });
    if (path.startsWith("/definitions/")) return json(response, definitions.get(path) ?? {});
    if (path === "/verify/ok") {
      response.writeHead(200, { "Set-Cookie": `${cookieName}=yes; Path=/; SameSite=Lax`, "Content-Type": "text/html; charset=utf-8" }); response.end("验证完成"); return;
    }
    if (path === "/verify/search" && !cookie) return html(response, `<button id="captcha" onclick="location.href='/verify/ok'">受控验证</button>`);
    if (path === "/verify/regex") return html(response, "VERIFY\nCAPTCHA");
    if (path === "/verify/fallback") return html(response, `<img id="captchaImage"><button id="captcha">受控验证</button>`);
    if (path === "/verify/status") return html(response, "受控验证", 403);
    if (path === "/chapters/protected") return html(response, pathCookie ? chapterHtml() : `<button id="captcha" onclick="location.href='/chapters/verified'">章节路径验证</button>`);
    if (path === "/chapters/verified") {
      response.writeHead(200, { "Set-Cookie": `${cookieName}_path=yes; Path=/chapters; SameSite=Lax`, "Content-Type": "text/html; charset=utf-8" }); response.end("章节路径验证完成"); return;
    }
    if (["/html/search", "/html/post", "/verify/search"].includes(path)) {
      if (offlineSearch) return json(response, { error: "fixture offline" }, 503);
      return html(response, searchHtml());
    }
    if (["/html/detail", "/html/detail2"].includes(path)) {
      if (offlineChapters) return json(response, { error: "fixture offline" }, 503);
      return html(response, chapterHtml());
    }
    if (path === "/slow/detail") { await delay(1600); return html(response, chapterHtml()); }
    if (path === "/fail/detail") return html(response, "受控来源加载失败", 503);
    if (path === "/html/ad-detail") return html(response, '<div class="road"><a href="/play/ad-before-content">第1集</a></div>');
    if (path === "/cancel/detail") return html(response, '<div class="road"><a href="/play/cancel">第1集</a></div>');
    if (path === "/api/search") return json(response, { data: { records: [{ id: 42, title: "API受控视频" }] } });
    if (path === "/api/nested/42") return json(response, { data: { revision: 8, roads: [{ name: "高清", episodes: [{ name: "第13集", id: "video" }, { name: "第14集", id: "fetch" }] }, { name: "旧解析", episodes: [{ name: "第15集", id: "legacy" }] }] } });
    if (path === "/api/delimited/42") return json(response, { data: { names: "甲$$$乙", urls: `第13集$/play/video#第14集$/play/fetch$$$第15集$/play/legacy` } });
    if (path === "/api/direct/42") return json(response, { data: { roads: [{ name: "直接流", episodes: [{ name: "第16集", url: `${base}media/video.mp4?signature=${signedGeneration}` }] }] } });
    if (path === "/api/extensionless/42") return json(response, { data: { roads: [{ name: "直接流", episodes: [{ name: "第17集", url: `${base}media/extensionless?signature=${signedGeneration}` }] }] } });
    if (path === "/play/video") return html(response, `<video controls></video><script>setTimeout(()=>document.querySelector('video').src='/media/video.mp4',120)</script>`);
    if (path === "/play/ad-before-content") return html(response, `<div class="action-ad"><video src="/media/advertisement.mp4" preload="auto"></video></div><script>setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<video controls src="/media/video.mp4"></video>'),180)</script>`);
    // No extension: this must be captured through Kazumi's Response.text hook.
    if (path === "/play/fetch") return html(response, `<script>setTimeout(()=>fetch('/media/manifest').then(r=>r.text()).then(x=>window.playlist=x),120)</script>`);
    if (path === "/play/xhr") return html(response, `<script>setTimeout(()=>{let r=new XMLHttpRequest;r.open('GET','/media/manifest');r.send()},120)</script>`);
    if (path === "/play/legacy") return html(response, `<iframe src="/iframe?url=${encodeURIComponent(Buffer.from(`${base}media/video.mp4`).toString("base64"))}"></iframe>`);
    if (path === "/play/cancel") return html(response, "<p>没有媒体的受控页面</p>");
    if (path === "/iframe") return html(response, "<p>旧式解析受控页面</p>");
    if (mediaPath(path)) {
      const fromPage = request.headers.referer?.startsWith(`${base}play/`);
      const fromProxy = request.headers["user-agent"] === "Genzo QA Rules Native" && request.headers.referer === `${base}qa-referer`;
      if (!cookie || (!fromPage && !fromProxy)) return json(response, { error: "fixture requires site cookie and referrer" }, 403);
      if (path === "/media/manifest" || path === "/media/media.m3u8") return sendMedia(request, response, Buffer.from(manifest), "application/vnd.apple.mpegurl");
      if (/^\/media\/segment\d{3}\.ts$/.test(path)) return sendMedia(request, response, readFileSync(`${hls}/${basename(path)}`), "video/mp2t");
      if (["/media/video.mp4", "/media/extensionless"].includes(path)) return sendMedia(request, response, mp4, "video/mp4");
    }
    response.writeHead(404); response.end();
  } catch (error) { if (!response.headersSent) response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port; base = `http://127.0.0.1:${port}/`;
command("reverse", `tcp:${port}`, `tcp:${port}`);
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
async function connect() {
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); command("shell", "wm", "dismiss-keyguard");
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1200);
  const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
  command("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true, timeout: 8000 });
  page = browser.contexts()[0].pages().find(candidate => candidate.url().includes("tauri.localhost")); assert.ok(page);
  page.setDefaultTimeout(20000);
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector(".android-app"));
  const info = await invoke("get_app_info");
  assert.equal(info.dataDirectory, `/data/user/0/${app}`); assert.equal(await page.evaluate(() => !!window.__GENZO_FRONTEND_PREVIEW__), false);
  return info;
}
function htmlRule(suffix, extra = {}) {
  return { api: "8", name: `${prefix} ${suffix}`, version: "1", baseURL: base, searchURL: `${base}html/search?q=@keyword`, searchList: "//div[@class='result']", searchName: "//a[@class='title']/span", searchResult: "//a[@class='title']", chapterRoads: "//div[@class='road']", chapterResult: "//a", useWebview: true, useLegacyParser: true, userAgent: "Genzo QA Rules Native", referer: `${base}qa-referer`, ...extra };
}
function apiRule(suffix, chapterPath, extra = {}) {
  return htmlRule(suffix, { searchMode: "api", chapterMode: "api", searchApiConfig: { request: { url: `${base}api/search`, method: "POST", bodyType: "json", body: { keyword: "@keyword", enabled: true, count: 7, nested: { values: [1, false] } } }, listPath: "$.data.records[*]", namePath: "$.title", sourcePath: "$.id" }, chapterApiConfig: { request: { url: `${base}${chapterPath}/@source`, method: "GET" } }, ...extra });
}
async function install(definition, fromUrl = false) {
  assert.ok(definition.name.startsWith(prefix));
  let id;
  if (fromUrl) { const path = `/definitions/${installed.length}.json`; definitions.set(path, definition); id = await invoke("import_rule_url", { url: `${base}${path.slice(1)}` }); }
  else id = await invoke("import_rule_plugin", { definition, origin: null });
  installed.push(id); return id;
}
const search = (pluginId, keyword = "你 / +", fresh = true) => invoke("search_rule_source", { pluginId, keyword, fresh });
const chapters = (pluginId, source, fresh = true) => invoke("get_rule_chapters", { pluginId, source, fresh });
const state = sessionId => invoke("get_internal_player_state", { sessionId });
const control = (sessionId, action) => invoke("control_internal_player", { sessionId, action });
async function until(read, accept, label, timeout = 25000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await read(); if (accept(last)) return last; await delay(250); }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}
async function playing(opened, label) {
  assert.ok(opened.sessionId, JSON.stringify(opened));
  const sample = await until(() => state(opened.sessionId), sample => {
    assert.notEqual(sample.status, "error", JSON.stringify(sample));
    return sample.status === "playing" && sample.positionMs > 500 && sample.durationMs > 10000;
  }, label);
  if (process.env.RULES_TEST_ANIME4K === "1") { assert.equal(sample.superResolution, 1); assert.match(sample.engine, /libmpv/); }
  result.snapshots[label] = sample;
  shot(label); return sample;
}
async function closePlayer(opened, hardware = false) {
  if (hardware) command("shell", "input", "keyevent", "KEYCODE_BACK");
  else await control(opened.sessionId, { type: "close" });
  await until(() => state(null), sample => ["closed", "idle"].includes(sample.status), "player close", 8000);
}
const preview = (pluginId, source, episodeIndex, roadIndex = 0) => invoke("preview_rule_episode", { pluginId, source, roadIndex, episodeIndex });
try {
  result.appInfo = await connect();
  const existingWorks = await invoke("list_works");
  const existingIds = existingWorks.map(work => work.id);
  const recordBefore = await invoke("get_playback_progress", { workId: null });
  // Dedicated package guard runs before any import or record creation.
  await invoke("list_rule_plugins"); result.cases.isolatedPackageGuard = true;
  const xpathDefinition = htmlRule("XPath GET");
  const xpath = await install(xpathDefinition, true);
  const found = await search(xpath);
  assert.deepEqual(found.items.map(item => item.name), ["受控视频甲", "受控视频乙"]);
  assert.deepEqual(found.items.map(item => item.source), [`${base}html/detail`, `${base}html/detail2`]);
  const source = found.items[0].source, roadData = await chapters(xpath, source);
  assert.deepEqual(roadData.roads.map(road => road.episodes.length), [2, 1, 1]);
  assert.deepEqual(roadData.roads[0].episodes.map(episode => episode.name), ["第13集", "第14集"]);
  result.cases.nativeXPathRelativeContextsAndInvalidURLFiltering = true;
  offlineSearch = true;
  const staleSearch = await search(xpath); assert.equal(staleSearch.stale, true); assert.equal(staleSearch.items.length, 2); offlineSearch = false;
  offlineChapters = true;
  const staleChapters = await chapters(xpath, source); assert.equal(staleChapters.stale, true); assert.equal(staleChapters.roads.length, 3); offlineChapters = false;
  result.cases.failedRefreshRetainsCatalog = true;
  const post = await install(htmlRule("XPath POST", { searchURL: `${base}html/post?q=@keyword&mode=qa`, usePost: true }));
  assert.equal((await search(post)).items.length, 2);
  const postRequest = requests.find(request => request.path === "/html/post");
  assert.equal(postRequest.method, "POST"); assert.equal(new URLSearchParams(postRequest.body).get("q"), "你 / +"); assert.deepEqual(postRequest.query, {});
  result.cases.nativeXPathPostFormEncoding = true;
  const bad = await install(htmlRule("Invalid XPath", { searchList: "//*[" }));
  await assert.rejects(() => search(bad), /XPath|无效/); result.cases.invalidXPathIsActionable = true;
  const nestedDefinition = apiRule("API nested", "api/nested", { chapterApiConfig: { request: { url: `${base}api/nested/@source`, query: { plain: true, count: 3 } }, variables: { revision: "$.data.revision" }, episodeUrlPath: "$.id", episodePage: { url: "/play/@episodeUrl?road=old&retained=yes", query: { revision: "@revision", road: "@roadIndex", episode: "@episodeNumber" } } } });
  const nested = await install(nestedDefinition);
  assert.deepEqual((await search(nested)).items, [{ name: "API受控视频", source: "42" }]);
  const typed = JSON.parse(requests.find(request => request.path === "/api/search").body);
  assert.deepEqual(typed, { keyword: "你 / +", enabled: true, count: 7, nested: { values: [1, false] } });
  const nestedRoads = await chapters(nested, "42"); assert.deepEqual(nestedRoads.roads.map(road => road.name), ["高清", "旧解析"]);
  const nestedUrl = new URL(nestedRoads.roads[0].episodes[1].url);
  assert.equal(nestedUrl.pathname, "/play/fetch"); assert.equal(nestedUrl.searchParams.get("revision"), "8"); assert.equal(nestedUrl.searchParams.get("road"), "0"); assert.equal(nestedUrl.searchParams.getAll("road").length, 1); assert.equal(nestedUrl.searchParams.get("retained"), "yes"); assert.equal(nestedUrl.searchParams.get("episode"), "2");
  result.cases.api8NestedTypedJSONAndEpisodeTemplates = true;
  const delimited = await install(apiRule("API delimited", "api/delimited", { chapterApiConfig: { request: { url: `${base}api/delimited/@source` }, format: "delimited", roadNamesPath: "$.data.names", roadEpisodesPath: "$.data.urls" } }));
  const delimitedRoads = await chapters(delimited, "42"); assert.deepEqual(delimitedRoads.roads.map(road => [road.name, road.episodes.length]), [["甲", 2], ["乙", 1]]);
  result.cases.api8DelimitedRoads = true;
  const verify = await install(htmlRule("Cookie verification", { searchURL: `${base}verify/search?q=@keyword`, antiCrawlerConfig: { enabled: true, captchaDetectType: 1, captchaDetectValue: "//*[@id='captcha']", captchaType: 2, captchaButton: "//*[@id='captcha']" } }));
  const challenge = await search(verify, "验证"); assert.equal(challenge.verificationRequired, true); assert.equal(challenge.items.length, 0);
  await invoke("verify_rule_source", { pluginId: verify, keyword: "验证" });
  await until(async () => requests.some(request => request.path === "/verify/ok"), Boolean, "isolated verification", 12000);
  const verificationPage = browser.contexts()[0].pages().find(candidate => candidate.url().includes("/verify/ok"));
  if (verificationPage) assert.equal(await verificationPage.evaluate(() => !!window.__TAURI_INTERNALS__), false);
  shot("verification-isolated"); command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(500);
  assert.equal((await search(verify, "验证")).items.length, 2); result.cases.siteVerificationCookieReusedWithoutAppBridge = true;
  if (process.env.RULES_TEST_CANCEL === "1") {
    for (const [name, path, config] of [
      ["Regex captcha", "regex", { captchaDetectType: 3, captchaDetectValue: "verify.*captcha" }],
      ["Fallback captcha", "fallback", { captchaInput: "//*[@id='missing-input']", captchaImage: "//*[@id='captchaImage']", captchaButton: "//*[@id='captcha']" }],
      ["HTTP captcha", "status", {}],
    ]) {
      const id = await install(htmlRule(name, { searchURL: `${base}verify/${path}?q=@keyword`, antiCrawlerConfig: { enabled: true, ...config } }));
      assert.equal((await search(id)).verificationRequired, true);
    }
    result.cases.regexFallbackAndHttpCaptchaDetection = true;
    assert.ok(requests.filter(request => ["/html/search", "/html/detail", "/html/post"].includes(request.path)).every(request => request.referer === base));
    const overrideDefinition = apiRule("API custom referer", "api/nested");
    overrideDefinition.searchApiConfig.request.headers = { Referer: `${base}custom-api` };
    const override = await install(overrideDefinition); await search(override);
    assert.equal(requests.filter(request => request.path === "/api/search").at(-1).referer, `${base}custom-api`);
    result.cases.searchAndChapterDefaultRefererAndApiOverride = true;
    const scoped = await install(htmlRule("Chapter scoped verification", { searchURL: `${base}html/post?q=@keyword`, usePost: true, antiCrawlerConfig: { enabled: true, captchaDetectType: 1, captchaDetectValue: "//*[@id='captcha']", captchaType: 2, captchaButton: "//*[@id='captcha']" } }));
    const scopedSource = `${base}chapters/protected`;
    const scopedChallenge = await chapters(scoped, scopedSource); assert.equal(scopedChallenge.verificationRequired, true);
    await invoke("verify_rule_source", { pluginId: scoped, keyword: "章节验证", url: scopedSource });
    await until(async () => requests.some(request => request.path === "/chapters/verified"), Boolean, "path scoped verification", 12000);
    command("shell", "input", "keyevent", "KEYCODE_BACK"); await delay(400);
    assert.equal((await chapters(scoped, scopedSource)).roads.length, 3);
    assert.ok(requests.filter(request => request.path.startsWith("/chapters/")).every(request => request.method === "GET"));
    assert.ok(requests.some(request => request.path === "/chapters/protected" && request.pathCookie));
    result.cases.chapterChallengeUrlAndPathScopedCookie = true;
  }
  const trial = await preview(xpath, source, 0); await playing(trial, "modern-video-mp4");
  assert.equal((await state(trial.sessionId)).mediaFileId, null);
  await closePlayer(trial, true);
  assert.deepEqual((await invoke("get_playback_progress", { workId: null })).items, recordBefore.items);
  assert.deepEqual((await invoke("list_works")).map(work => work.id), existingIds);
  result.cases.modernVideoTrialHasNoLibraryOrWatchRecords = true;
  const adSource = `${base}html/ad-detail`;
  await chapters(xpath, adSource);
  const adTrial = await preview(xpath, adSource, 0);
  await playing(adTrial, "content-after-ad-placeholder");
  assert.ok(!requests.some(request => request.path === "/media/advertisement.mp4" && request.userAgent === "Genzo QA Rules Native"));
  await closePlayer(adTrial);
  result.cases.adVideoCannotReplaceEpisode = true;
  const hlsTrial = await preview(xpath, source, 1); await playing(hlsTrial, "modern-fetch-hls");
  const hlsReady = await until(() => state(hlsTrial.sessionId), sample => sample.seekable, "HLS seekable"); assert.ok(hlsReady.durationMs > 30000);
  await control(hlsTrial.sessionId, { type: "seek", positionMs: 22000 });
  await until(() => state(hlsTrial.sessionId), sample => sample.positionMs >= 20000, "HLS seek");
  await control(hlsTrial.sessionId, { type: "pause" }); await until(() => state(hlsTrial.sessionId), sample => sample.status === "paused", "HLS pause");
  shot("hls-seek-paused"); await closePlayer(hlsTrial, true);
  result.cases.modernFetchHlsAndNativeSeekPauseBack = true;
  const legacy = await preview(xpath, source, 0, 1); await playing(legacy, "legacy-iframe-base64-mp4"); await closePlayer(legacy, true);
  result.cases.legacyIframeBase64Parser = true;
  const xhr = await preview(xpath, source, 0, 2); await playing(xhr, "modern-xhr-hls"); await closePlayer(xhr, true);
  result.cases.modernXhrHlsParser = true;
  const work = await invoke("create_work", { input: { title: `${prefix} synthetic work`, originalTitle: null, type: "video", description: "本脚本自建的播放器验收作品", coverPath: null, status: "in_progress", favorite: true, rating: 9, tags: ["QA Rules"], notes: "保留资料与进度" } });
  result.workId = work.id;
  const input = { workId: work.id, pluginId: xpath, source, title: "受控视频甲", roadIndex: 0, episodeIndexes: [0], episodeOffset: 12, replaceExisting: false };
  const bound = await invoke("play_rule_episode", { input }); await playing(bound, "bound-native-mp4");
  const mediaId = (await state(bound.sessionId)).mediaFileId; assert.ok(mediaId);
  const boundDetail = await invoke("get_work", { id: work.id }); assert.equal(boundDetail.mediaFiles.length, 1); assert.equal(boundDetail.mediaFiles[0].id, mediaId);
  assert.deepEqual((await invoke("list_works")).find(item => item.id === work.id).sourceScopes, ["network"]);
  assert.equal((await invoke("get_video_source_states")).find(item => item.id === xpath)?.kind, "rule");
  await assert.rejects(() => invoke("scan_library_root", { id: xpath }), /规则|来源/);
  result.cases.ruleProviderClassifiedAsNetwork = true;
  await until(() => state(bound.sessionId), sample => sample.seekable, "MP4 seekable");
  await control(bound.sessionId, { type: "seek", positionMs: 17000 }); await until(() => state(bound.sessionId), sample => sample.positionMs >= 16000, "MP4 seek");
  await control(bound.sessionId, { type: "pause" }); const paused = await until(() => state(bound.sessionId), sample => sample.status === "paused", "MP4 pause");
  result.snapshots.boundPaused = paused; shot("bound-mp4-seek-paused"); await closePlayer(bound, true);
  const saved = await until(() => invoke("get_playback_progress", { workId: work.id }), overview => overview.items.some(item => item.mediaFileId === mediaId && item.positionMs >= 16000), "saved native progress");
  result.snapshots.savedProgress = saved.items.find(item => item.mediaFileId === mediaId);
  const reopened = await invoke("open_internal_player", { mediaFileId: mediaId, restart: false, subtitleId: null });
  await playing(reopened, "bound-resumed-mp4"); const resumed = await state(reopened.sessionId);
  assert.ok(resumed.positionMs >= 15000 && resumed.positionMs < 23000, JSON.stringify(resumed)); await closePlayer(reopened, true);
  result.cases.workSingleEpisodeBindingAndNativeResume = true;
  const updatedDefinition = { ...xpathDefinition, version: "2" };
  const originPath = [...definitions.keys()][0]; definitions.set(originPath, updatedDefinition);
  assert.equal(await invoke("update_rule_plugin", { id: xpath }), xpath);
  const bindingPreview = await invoke("preview_rule_binding", { input: { ...input, episodeOffset: 0 } }); assert.equal(bindingPreview.rows[0].existing, true);
  assert.deepEqual(await invoke("bind_rule_episodes", { input: { ...input, episodeOffset: 0 }, token: bindingPreview.token }), [mediaId]);
  assert.equal((await invoke("get_work", { id: work.id })).mediaFiles[0].id, mediaId);
  assert.ok((await invoke("get_playback_progress", { workId: work.id })).items.some(item => item.mediaFileId === mediaId && item.positionMs >= 16000));
  result.cases.ruleUpdatePreservesStableMediaAndProgress = true;
  await invoke("set_rule_plugin_enabled", { id: xpath, enabled: false, remove: false });
  await assert.rejects(() => invoke("open_internal_player", { mediaFileId: mediaId, restart: false, subtitleId: null }), /停用|移除|不可用/);
  await invoke("set_rule_plugin_enabled", { id: xpath, enabled: true, remove: false }); result.cases.disabledSourceCannotPlay = true;
  const directDefinition = apiRule("Signed direct media", "api/direct", { useWebview: false });
  const direct = await install(directDefinition); await chapters(direct, "42");
  const directInput = { ...input, pluginId: direct, source: "42", title: "直接流验收" };
  const directPlay = await invoke("play_rule_episode", { input: directInput }); await playing(directPlay, "signed-direct-mp4"); const directId = (await state(directPlay.sessionId)).mediaFileId; await closePlayer(directPlay, true);
  signedGeneration = 2;
  const signedReopen = await invoke("open_internal_player", { mediaFileId: directId, restart: true, subtitleId: null }); await playing(signedReopen, "signed-renewed-mp4");
  assert.equal((await state(signedReopen.sessionId)).mediaFileId, directId); await closePlayer(signedReopen, true);
  assert.ok(requests.some(request => request.path === "/media/video.mp4" && request.query.signature === "2"));
  const directDetail = await invoke("get_work", { id: work.id }); assert.ok(directDetail.mediaFiles.filter(file => file.libraryRootId === direct).every(file => file.path.startsWith("rule://") && !file.path.includes("signature")));
  result.cases.signedMediaRenewalKeepsVirtualIdentity = true;
  if (process.env.RULES_TEST_EXTENSIONLESS === "1") {
    const extensionless = await install(apiRule("Extensionless stream", "api/extensionless", { useWebview: false }));
    await chapters(extensionless, "42"); const opened = await preview(extensionless, "42", 0); await playing(opened, "extensionless-direct-mp4"); await closePlayer(opened, true);
    result.cases.extensionlessDirectMedia = true;
  }
  if (process.env.RULES_TEST_CANCEL === "1") {
    const cancel = await install(htmlRule("Cancel during chapter request"));
    const requestCount = requests.filter(request => request.path === "/slow/detail").length;
    const begin = Date.now();
    const pending = await preview(cancel, `${base}slow/detail`, 0);
    assert.ok(Date.now() - begin < 1200, "opening must not wait for the delayed chapter response");
    assert.equal(pending.status, "opening");
    await until(async () => requests.filter(request => request.path === "/slow/detail").length > requestCount, Boolean, "delayed chapter request begins");
    const foregroundLoading = command("shell", "dumpsys", "activity", "activities");
    assert.ok(foregroundLoading.split("\n").filter(line => /mResumedActivity|topResumedActivity/.test(line)).some(line => line.includes("PlayerActivity")));
    const loadingState = await until(() => invoke("android_native", { command: "playerState", payload: {} }), sample => sample.sessionId === pending.sessionId, "new native loading session", 1500);
    assert.equal(loadingState.sessionId, pending.sessionId); assert.match(loadingState.loadingMessage, /获取剧集/);
    await delay(350);
    shot("native-loading-chapters");
    result.cases.nativePlayerOpensBeforeChapterResponse = true;
    command("shell", "input", "keyevent", "KEYCODE_BACK");
    await until(() => state(null), sample => ["idle", "closed"].includes(sample.status), "pending player back closes");
    await delay(1800);
    const foreground = command("shell", "dumpsys", "activity", "activities");
    assert.ok(!foreground.split("\n").filter(line => /mResumedActivity|topResumedActivity/.test(line)).some(line => line.includes("PlayerActivity")));
    assert.ok(["idle", "closed"].includes((await state(null)).status));
    result.cases.cancelledChapterResponseCannotOpenNativePlayer = true;
    const failed = await preview(cancel, `${base}fail/detail`, 0);
    const failure = await until(() => state(failed.sessionId), sample => sample.status === "error", "loading failure stays in player");
    assert.match(failure.error.message, /503/); shot("native-loading-failure");
    await closePlayer(failed, true);
    result.cases.loadingFailureDisplayedInPlayer = true;
    await preview(cancel, `${base}cancel/detail`, 0);
    await until(async () => requests.some(request => request.path === "/play/cancel"), Boolean, "headless source renderer begins");
    await invoke("cancel_rule_resolve");
    await until(() => state(null), sample => ["idle", "closed"].includes(sample.status), "headless player cancellation");
    result.cases.headlessWebviewCancellation = true;
    const slowBefore = requests.filter(request => request.path === "/slow/detail").length;
    await preview(cancel, `${base}slow/detail?race=new-player`, 0);
    await until(async () => requests.filter(request => request.path === "/slow/detail").length > slowBefore, Boolean, "old chapter request begins");
    await invoke("cancel_rule_resolve");
    const newPlayer = await preview(xpath, source, 0);
    await playing(newPlayer, "new-player-after-cancel");
    await delay(1800);
    const newState = await state(newPlayer.sessionId); assert.equal(newState.sessionId, newPlayer.sessionId); assert.equal(newState.status, "playing");
    await closePlayer(newPlayer, true);
    result.cases.oldCancelledResponseCannotDisruptNewPlayer = true;
  }
  const proxyRequests = requests.filter(request => mediaPath(request.path) && request.userAgent === "Genzo QA Rules Native");
  assert.ok(proxyRequests.some(request => request.path.endsWith(".ts"))); assert.ok(proxyRequests.some(request => request.range));
  assert.ok(proxyRequests.every(request => request.cookie && request.referer === `${base}qa-referer`));
  result.cases.cookieRefererUserAgentReachMp4HlsSegmentsAndRanges = true;
  if (process.env.RULES_TEST_CANCEL === "1") {
    const desktopUA = request => request.userAgent?.includes("Windows NT") && !request.userAgent.includes("Android");
    for (const paths of [["/html/search", "/html/detail", "/html/post"], ["/play/video", "/play/fetch", "/play/xhr", "/play/legacy"], ["/verify/ok", "/chapters/verified"]]) {
      const group = requests.filter(request => paths.includes(request.path));
      assert.ok(group.length > 0); assert.ok(group.every(desktopUA), `expected desktop UA for ${paths.join(", ")}`);
    }
    result.cases.desktopUserAgentAcrossHttpResolverAndVerification = true;
  }
  const personalBeforeRemove = await invoke("get_work", { id: work.id });
  const progressBeforeRemove = (await invoke("get_playback_progress", { workId: work.id })).items;
  await invoke("set_rule_plugin_enabled", { id: xpath, enabled: false, remove: true });
  const personalAfterRemove = await invoke("get_work", { id: work.id });
  for (const key of ["title", "favorite", "rating", "notes", "status"]) assert.equal(personalAfterRemove[key], personalBeforeRemove[key]);
  assert.equal(personalAfterRemove.mediaFiles.find(file => file.id === mediaId)?.missing, true);
  assert.deepEqual((await invoke("get_playback_progress", { workId: work.id })).items.map(({ missing, ...item }) => item), progressBeforeRemove.map(({ missing, ...item }) => item));
  assert.ok(!(await invoke("list_rule_plugins")).some(plugin => plugin.id === xpath));
  assert.ok(requests.every(request => ["GET", "POST", "HEAD"].includes(request.method)));
  result.cases.softRemovalKeepsLibraryAndViewingData = true;
  const ownIds = new Set([work.id]);
  assert.deepEqual((await invoke("list_works")).filter(work => !ownIds.has(work.id)).map(work => work.id).sort(), existingIds.sort());
  result.cases.preexistingQaWorksRemain = true;
  if (process.env.RULES_TEST_PUBLIC === "1") {
    const liveBefore = await invoke("list_rule_plugins");
    const catalog = await invoke("get_rule_catalog", { fresh: true });
    assert.ok(catalog.items.length > 1, "official rule repository must contain active sources");
    result.publicRepository = { count: catalog.items.length, stale: catalog.stale, warning: catalog.warning ?? null, sources: [] };
    result.cases.officialRepositoryCatalog = true;
    for (const name of ["7sefun", "sorani"]) {
      const entry = catalog.items.find(item => item.name.toLowerCase() === name.toLowerCase());
      assert.ok(entry, `expected active rule ${name}`);
      const sourceResult = { name: entry.name, version: entry.version };
      try {
        const old = liveBefore.find(plugin => plugin.name.toLowerCase() === entry.name.toLowerCase());
        const id = old?.id ?? await invoke("install_catalog_rule", { name: entry.name });
        if (!old) publicInstalled.push({ id, name: entry.name });
        const definition = await invoke("get_rule_definition", { id });
        sourceResult.mode = definition.searchMode === "api" ? "api" : "xpath";
        sourceResult.installed = true;
        let found = await search(id, "葬送的芙莉莲");
        if (!found.verificationRequired && found.items.length === 0) found = await search(id, "海贼王");
        sourceResult.searchCount = found.items.length; sourceResult.verificationRequired = found.verificationRequired;
        sourceResult.stale = found.stale;
        if (found.items.length) {
          const roads = await chapters(id, found.items[0].source);
          sourceResult.roadCount = roads.roads.length;
          sourceResult.episodeCount = roads.roads.reduce((total, road) => total + road.episodes.length, 0);
          sourceResult.verificationRequired ||= roads.verificationRequired;
          sourceResult.success = sourceResult.roadCount > 0;
        } else sourceResult.success = false;
      } catch (error) { sourceResult.success = false; sourceResult.error = String(error).replace(/https?:\/\/\S+/g, "[来源网址]"); }
      result.publicRepository.sources.push(sourceResult);
    }
    // Source-site availability is evidence, not a fabricated all-sites guarantee.
    result.cases.publicXPathAndApiCompatibilityRecorded = true;
  }
  result.passed = true;
  console.log(JSON.stringify({ output, passed: true, cases: result.cases }));
} catch (error) {
  result.error = String(error); result.stack = error.stack;
  try { shot("failure"); } catch {}
  throw error;
} finally {
  // Remove only this run's QA rule connections; keep evidence and watch records.
  if (page) {
    try {
      const current = await state(null); if (current.sessionId && !["idle", "closed"].includes(current.status)) await control(current.sessionId, { type: "close" });
      const live = await invoke("list_rule_plugins");
      for (const plugin of live.filter(plugin => installed.includes(plugin.id) && plugin.name.startsWith(prefix))) await invoke("set_rule_plugin_enabled", { id: plugin.id, enabled: false, remove: true });
      for (const plugin of publicInstalled.filter(plugin => live.some(candidate => candidate.id === plugin.id && candidate.name === plugin.name))) await invoke("set_rule_plugin_enabled", { id: plugin.id, enabled: false, remove: true });
    } catch (error) { result.cleanupError = String(error); }
  }
  writeFileSync(`${output}/requests.json`, JSON.stringify(requests, null, 2)); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser?.close();
  command("reverse", "--remove", `tcp:${port}`); command("forward", "--remove", "tcp:9346");
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
