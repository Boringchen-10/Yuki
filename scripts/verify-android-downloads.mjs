import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";

// Never make the package configurable: this script may only mutate synthetic organizeqa data.
const app = "com.genzo.android.organizeqa", expectedData = `/data/user/0/${app}`;
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000";
const cdpPort = 9347, run = Date.now(), title = `GenzoOfflineQA-${run}`;
const output = `${process.env.GENZO_ANDROID_DOWNLOAD_QA_DIR || "D:/DevTools/Android/Build/qa/downloads-history-20261014/native-downloads"}/${run}`;
const sample = "D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4";
mkdirSync(output, { recursive: true });
const media = readFileSync(sample), fileName = `${title}-01.mp4`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 25000, maxBuffer: 8 * 1024 * 1024 });
const deviceBytes = (...args) => execFileSync(adb, ["-s", serial, ...args], { timeout: 25000, maxBuffer: 24 * 1024 * 1024 });
const result = { app, run, output, cases: {}, skipped: {}, cleanup: [], requests: { catalog: [], media: [] } };
let browser, page, info, guarded = false, sourceId, workId, pluginId, originalPreferences;
let mediaServer, mediaPort, catalogServer, catalogPort, ticket = 1, failRetry = true, throttle = true;
const videoIds = new Set(), jobIds = new Set(), ownedSessions = new Set();
let hlsDirectory;

function prepareHls() {
  const supplied = process.env.GENZO_QA_HLS_DIR;
  if (supplied) {
    hlsDirectory = resolve(supplied);
    assert.ok(existsSync(join(hlsDirectory, "index.m3u8")), "GENZO_QA_HLS_DIR must contain a synthetic VOD index.m3u8");
    return;
  }
  const ffmpeg = process.env.GENZO_QA_FFMPEG || "ffmpeg";
  try { execFileSync(ffmpeg, ["-version"], { encoding: "utf8", timeout: 5000, stdio: "pipe" }); }
  catch { result.skipped.hls = "No local ffmpeg or explicit synthetic HLS fixture. Progressive MP4 is still required."; return; }
  hlsDirectory = resolve(output, "generated-hls"); mkdirSync(hlsDirectory, { recursive: true });
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", sample, "-c", "copy", "-hls_time", "3", "-hls_playlist_type", "vod", "-hls_segment_filename", join(hlsDirectory, "segment-%03d.ts"), join(hlsDirectory, "index.m3u8")], { encoding: "utf8", timeout: 30000 });
  assert.ok(readFileSync(join(hlsDirectory, "index.m3u8"), "utf8").includes("#EXT-X-ENDLIST"));
}
function sendMedia(req, res, data, mime, slow = false) {
  const range = req.headers.range;
  let start = 0, end = data.length - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || !match[1] && !match[2]) { res.writeHead(416, { "Content-Range": `bytes */${data.length}` }); res.end(); return; }
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    else start = Math.max(0, data.length - Number(match[2]));
    if (start > end || start >= data.length) { res.writeHead(416, { "Content-Range": `bytes */${data.length}` }); res.end(); return; }
  }
  res.writeHead(range ? 206 : 200, { "Content-Type": mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "ETag": `"${title}-stable"`, "Last-Modified": "Wed, 14 Oct 2026 00:00:00 GMT", ...(range ? { "Content-Range": `bytes ${start}-${end}/${data.length}` } : {}) });
  if (req.method === "HEAD") { res.end(); return; }
  if (!slow) { res.end(data.subarray(start, end + 1)); return; }
  let offset = start, timer;
  const next = () => {
    if (res.destroyed) return;
    const limit = Math.min(offset + 32768, end + 1);
    res.write(data.subarray(offset, limit)); offset = limit;
    if (offset > end) res.end(); else timer = setTimeout(next, 40);
  };
  res.once("close", () => clearTimeout(timer)); next();
}
function makeMediaServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"), path = url.pathname;
    const record = { path, ticket: url.searchParams.get("ticket"), method: req.method, range: req.headers.range || null };
    result.requests.media.push(record);
    if (path.startsWith("/dav/")) {
      record.authorized = req.headers.authorization === `Basic ${Buffer.from("qa:own-fixture").toString("base64")}`;
      if (!record.authorized) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Genzo offline QA"' }); res.end(); return; }
      if (req.method === "PROPFIND") {
        const item = (href, folder) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${folder ? "<d:collection/>" : ""}</d:resourcetype>${folder ? "" : `<d:getcontentlength>${media.length}</d:getcontentlength><d:getetag>\"${title}-stable\"</d:getetag><d:getlastmodified>Wed, 14 Oct 2026 00:00:00 GMT</d:getlastmodified>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
        res.writeHead(207, { "Content-Type": "application/xml" }); res.end(`<d:multistatus xmlns:d="DAV:">${item("/dav/", true)}${item(`/dav/${fileName}`, false)}</d:multistatus>`); return;
      }
      if (path === `/dav/${fileName}`) { sendMedia(req, res, media, "video/mp4", throttle); return; }
      res.writeHead(404); res.end(); return;
    }
    if (path.startsWith("/rule/") || path.startsWith("/hls/")) {
      record.headersAccepted = req.headers.referer === `http://127.0.0.1:${catalogPort}/allowed` && req.headers["user-agent"] === "GenzoOfflineQA/1";
      if (!record.headersAccepted) { res.writeHead(403); res.end(); return; }
      if ((path.startsWith("/rule/") && Number(url.searchParams.get("ticket")) !== ticket) || (path === "/rule/two.mp4" && failRetry)) { res.writeHead(503); res.end(); return; }
      if (["/rule/one.mp4", "/rule/two.mp4"].includes(path)) { sendMedia(req, res, media, "video/mp4", throttle); return; }
      if (hlsDirectory && path.startsWith("/hls/")) {
        const target = resolve(hlsDirectory, decodeURIComponent(path.slice(5)));
        if (!target.startsWith(`${hlsDirectory}${sep}`) || !existsSync(target)) { res.writeHead(404); res.end(); return; }
        sendMedia(req, res, readFileSync(target), target.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"); return;
      }
    }
    res.writeHead(404); res.end();
  });
}
async function listen(server, port = 0) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); }); return server.address().port; }
async function stopMedia() { if (!mediaServer) return; const previous = mediaServer; mediaServer = null; previous.closeAllConnections(); await new Promise(resolve => previous.close(resolve)); }
async function startMedia() { assert.equal(mediaServer, null); mediaServer = makeMediaServer(); await listen(mediaServer, mediaPort); }
async function invoke(name, args = {}, timeout = 20000) {
  let timer;
  try { return await Promise.race([page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`RPC timeout: ${name}`)), timeout); })]); }
  finally { clearTimeout(timer); }
}
const native = (command, payload = {}) => invoke("android_native", { command, payload });
async function verifyGuard() {
  assert.equal(app, "com.genzo.android.organizeqa");
  info = await invoke("get_app_info");
  assert.equal(info.dataDirectory, expectedData); assert.equal(info.databasePath, `${expectedData}/genzo.db`);
  guarded = true;
}
async function connect() {
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
  let last;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await delay(500);
      const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
      command("forward", `tcp:${cdpPort}`, `localabstract:webview_devtools_remote_${pid}`);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true, timeout: 4000 });
      page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost")); assert.ok(page);
      await verifyGuard(); return;
    } catch (error) { last = error; await browser?.close().catch(() => {}); browser = null; }
  }
  throw last;
}
async function wait(read, accept, label, timeout = 45000) {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await read(); if (accept(value)) return value; await delay(250); }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
const videos = async () => (await invoke("list_video_downloads")).downloads;
const video = id => wait(videos, rows => rows.some(row => row.id === id), `video task ${id}`).then(rows => rows.find(row => row.id === id));
async function waitVideo(id, state, timeout) { return (await wait(videos, rows => rows.some(row => row.id === id && row.state === state), `video ${state}`, timeout)).find(row => row.id === id); }
const jobs = () => invoke("list_download_jobs");
async function waitJob(id, state) { return (await wait(jobs, rows => rows.some(row => row.id === id && row.state === state), `file ${state}`, 60000)).find(row => row.id === id); }
function shot(name) {
  const foreground = command("shell", "dumpsys", "activity", "activities").split("\n").find(line => line.includes("topResumedActivity"));
  assert.ok(foreground?.includes(app), "screenshots must only capture the foreground synthetic QA app");
  writeFileSync(`${output}/${name}.png`, deviceBytes("exec-out", "screencap", "-p"));
}
function dump() {
  const path = `/data/local/tmp/genzo-downloads-${run}.xml`;
  try { command("shell", "uiautomator", "dump", path); }
  catch (error) { if (!String(error.stdout).includes(`UI hierchary dumped to: ${path}`)) throw error; }
  return command("shell", "cat", path);
}
async function closePlayer() {
  const state = await native("playerState");
  if (ownedSessions.has(state.sessionId) && state.status !== "closed") {
    await native("playerControl", { action: "close", sessionId: state.sessionId });
    await wait(() => native("playerState"), value => value.status === "closed", "player close");
    await delay(600);
  }
}
async function offlinePlay(commandName, args, mediaId, name, seek = true) {
  assert.equal(mediaServer, null, "the upstream media server must be stopped before offline playback");
  const catalogReads = result.requests.catalog.length, networkReads = result.requests.media.length;
  const opened = await invoke(commandName, args); ownedSessions.add(opened.sessionId);
  let current = await wait(() => native("playerState"), value => value.sessionId === opened.sessionId && value.status === "playing" && value.durationMs > 1000 && Number(value.videoWidth) > 0 && Number(value.videoHeight) > 0, `${name} real libmpv playback`);
  assert.equal(current.mediaFileId, mediaId); assert.ok(current.engineInitialized); assert.equal(current.engine, "libmpv");
  await native("playerControl", { action: "pause", sessionId: current.sessionId });
  await native("playerControl", { action: "portrait", sessionId: current.sessionId });
  const xml = await wait(async () => dump(), value => value.includes("离线缓存"), `${name} offline page`);
  assert.ok(!xml.includes("正在解析播放地址"));
  shot(name);
  if (seek) {
    const target = Math.min(8000, Math.floor(current.durationMs / 3));
    await native("playerControl", { action: "seek", value: target, sessionId: current.sessionId });
    current = await wait(() => native("playerState"), value => value.positionMs >= target - 1500 && value.mediaFileId === mediaId, `${name} cached range seek`);
  }
  assert.equal(result.requests.catalog.length, catalogReads, "offline playback must not re-resolve the rule catalog");
  assert.equal(result.requests.media.length, networkReads, "offline playback must not reach upstream media");
  result.cases[name] = { mediaId, durationMs: current.durationMs, positionMs: current.positionMs, engine: current.engine };
  await closePlayer();
  const saved = await wait(() => invoke("get_playback_progress"), value => value.items.some(item => item.mediaFileId === mediaId && item.positionMs >= Math.max(1, current.positionMs - 1500)), `${name} stable playback progress`);
  return saved.items.find(item => item.mediaFileId === mediaId);
}
async function showDownloadCenter(name) {
  await page.evaluate(() => { location.hash = "#/downloads"; });
  await page.getByRole("heading", { name: "下载中心", exact: true }).first().waitFor({ timeout: 12000 });
  await page.getByRole("tab", { name: /已完成/ }).click();
  await page.locator("[data-download-key]").filter({ hasText: title }).first().waitFor({ timeout: 12000 });
  assert.ok((await page.locator(".gz-download-center").innerText()).includes("已完成"));
  await delay(350); shot(name);
}
async function cleanup() {
  if (!guarded) return;
  if (!browser || page.isClosed()) await connect();
  await verifyGuard(); await closePlayer();
  for (const id of videoIds) {
    try { await invoke("control_video_download", { id, action: "remove" }); await wait(videos, rows => !rows.some(row => row.id === id), "remove own video", 15000); result.cleanup.push(`video:${id}`); }
    catch (error) { result.cleanup.push(`video cleanup failed: ${String(error)}`); result.cleanupFailed = true; }
  }
  for (const id of jobIds) {
    try { await invoke("control_download_job", { id, action: "remove" }); result.cleanup.push(`job:${id}`); }
    catch (error) { result.cleanup.push(`file cleanup failed: ${String(error)}`); result.cleanupFailed = true; }
  }
  if (workId) {
    const work = await invoke("get_work", { id: workId }); assert.equal(work.title, title);
    await invoke("delete_work", { id: workId }); result.cleanup.push(`work:${workId}`);
  }
  if (pluginId) {
    const plugin = (await invoke("list_rule_plugins")).find(item => item.id === pluginId); assert.equal(plugin?.name, title);
    await invoke("set_rule_plugin_enabled", { id: pluginId, enabled: false, remove: true }); result.cleanup.push(`plugin:${pluginId}`);
  }
  if (sourceId) { await invoke("remove_webdav_source", { id: sourceId }); result.cleanup.push(`source:${sourceId}`); }
  if (originalPreferences) await invoke("set_android_playback_preferences", { settings: originalPreferences });
  if (result.cleanupFailed) throw new Error("Some own QA download tasks could not be cleaned; inspect result.cleanup.");
}

let failure;
try {
  prepareHls();
  catalogServer = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    result.requests.catalog.push({ path: url.pathname, ticket });
    if (url.pathname === "/detail/fixture") {
      const episodes = [{ name: "第13集", url: `http://127.0.0.1:${mediaPort}/rule/one.mp4?ticket=${ticket}` }, { name: "第14集", url: `http://127.0.0.1:${mediaPort}/rule/two.mp4?ticket=${ticket}` }];
      if (hlsDirectory) episodes.push({ name: "第15集", url: `http://127.0.0.1:${mediaPort}/hls/index.m3u8` });
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: { roads: [{ name: "QA VOD", episodes }] } }));
    } else { res.writeHead(404); res.end(); }
  });
  catalogPort = await listen(catalogServer); mediaServer = makeMediaServer(); mediaPort = await listen(mediaServer);
  command("reverse", `tcp:${catalogPort}`, `tcp:${catalogPort}`); command("reverse", `tcp:${mediaPort}`, `tcp:${mediaPort}`);
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); await connect();
  result.cases.guardedSyntheticPackage = { dataDirectory: info.dataDirectory, databasePath: info.databasePath };
  originalPreferences = await invoke("get_android_playback_preferences");
  await invoke("set_android_playback_preferences", { settings: { hardwareDecoding: true, hardwareDecoder: "mediacodec-copy", videoRenderer: "gpu", superResolution: 0 } });
  const existing = await native("playerState"); assert.ok(!existing.sessionId || existing.status === "closed", "Close any existing organizeqa player before this isolated run");
  sourceId = await invoke("add_webdav_source", { input: { name: title, endpoint: `http://127.0.0.1:${mediaPort}`, directory: "/dav/", username: "qa", password: "own-fixture", kind: "video" } });
  const files = (await wait(() => invoke("list_unassigned_media", { destination: "media" }), rows => rows.some(row => row.libraryRootId === sourceId && row.fileName === fileName), "new synthetic WebDAV scan", 60000)).filter(row => row.libraryRootId === sourceId);
  const davFile = files.find(row => row.fileName === fileName); assert.ok(davFile);
  await wait(() => invoke("list_source_imports"), tasks => !tasks.some(task => task.sourceIds.includes(sourceId) && ["queued", "scanning", "recognizing", "enriching"].includes(task.stage)), "new synthetic source import finishes", 60000);
  const work = await invoke("create_work_from_media", { mediaFileId: davFile.id, selectedMediaIds: [davFile.id], input: { title, originalTitle: null, type: "video", description: "Own synthetic offline download QA", coverPath: null, status: "planned", favorite: false, rating: null, tags: [], notes: "" } }); workId = work.id;
  pluginId = await invoke("import_rule_plugin", { definition: { api: "8", name: title, version: "1", baseURL: `http://127.0.0.1:${catalogPort}/`, searchMode: "api", chapterMode: "api", searchApiConfig: { request: { url: `http://127.0.0.1:${catalogPort}/search?q=@keyword` } }, chapterApiConfig: { request: { url: `http://127.0.0.1:${catalogPort}/detail/@source` } }, useWebview: false, useLegacyParser: false, referer: `http://127.0.0.1:${catalogPort}/allowed`, userAgent: "GenzoOfflineQA/1" }, origin: null });
  const input = { workId, pluginId, source: "fixture", title, roadIndex: 0, episodeIndexes: hlsDirectory ? [0, 1, 2] : [0, 1], episodeOffset: 12, replaceExisting: false };
  const preview = await invoke("preview_rule_binding", { input }); assert.equal(preview.rows.some(row => row.conflict), false);
  const ruleMedia = await invoke("bind_rule_episodes", { input, token: preview.token }); assert.equal(ruleMedia.length, input.episodeIndexes.length);
  const request = indexes => invoke("enqueue_rule_downloads", { input: { workId, pluginId, source: "fixture", title, roadIndex: 0, episodeIndexes: indexes } });
  const first = (await request([0]))[0]; videoIds.add(first.id);
  writeFileSync(`${output}/seed.json`, JSON.stringify({ app, title, sourceId, workId, pluginId, davMediaId: davFile.id, ruleMedia, videoId: first.id }, null, 2));
  await wait(videos, rows => rows.some(row => row.id === first.id && row.state === "downloading" && row.bytesDownloaded > 65536), "progressive real download progress");
  await invoke("control_video_download", { id: first.id, action: "pause" }); await waitVideo(first.id, "paused");
  const duplicate = await request([0, 0]); assert.equal(duplicate.length, 1); assert.equal(duplicate[0].id, first.id);
  const paused = await video(first.id); assert.equal(paused.state, "paused");
  assert.equal((await videos()).filter(row => row.id === first.id).length, 1);
  result.cases.stableDedupAndPause = { id: first.id, bytesDownloaded: paused.bytesDownloaded };
  const requestsBeforeRestart = result.requests.media.length;
  await browser.close(); browser = null; command("shell", "am", "force-stop", app); await connect();
  assert.equal((await video(first.id)).state, "paused"); await delay(500);
  assert.equal(result.requests.media.length, requestsBeforeRestart, "restoring a paused task must not restart downloads");
  result.cases.pausedQueueSurvivesProcessRestart = true;
  throttle = false; await invoke("control_video_download", { id: first.id, action: "resume" });
  const completed = await waitVideo(first.id, "completed", 60000);
  assert.equal(completed.mediaFileId, ruleMedia[0]); assert.equal(completed.bytesDownloaded, media.length);
  result.cases.progressiveCompletes = { bytesDownloaded: completed.bytesDownloaded, totalBytes: completed.totalBytes };
  await stopMedia(); const progress = await offlinePlay("open_downloaded_video", { id: first.id }, ruleMedia[0], "rule-offline-libmpv");
  await showDownloadCenter("download-center-completed");
  await browser.close(); browser = null; command("shell", "am", "force-stop", app); await connect();
  assert.equal((await video(first.id)).state, "completed");
  const restored = await offlinePlay("open_downloaded_video", { id: first.id }, ruleMedia[0], "rule-offline-after-restart", false);
  assert.ok(restored.positionMs >= progress.positionMs - 1500);
  result.cases.completedQueueAndPlaybackSurviveRestart = true;
  await startMedia(); ticket = 2;
  const retry = (await request([1]))[0]; videoIds.add(retry.id); await waitVideo(retry.id, "failed", 60000);
  const catalogBeforeRetry = result.requests.catalog.length; ticket = 3; failRetry = false;
  await invoke("control_video_download", { id: retry.id, action: "retry" });
  const retried = await waitVideo(retry.id, "completed", 60000);
  assert.equal(retried.mediaFileId, ruleMedia[1]); assert.equal(retried.id, retry.id);
  assert.ok(result.requests.catalog.length > catalogBeforeRetry);
  assert.ok(result.requests.media.some(request => request.path === "/rule/two.mp4" && request.ticket === "3"));
  result.cases.failureRetryReResolvesFreshTicketUnderStableId = true;
  if (hlsDirectory) {
    const task = (await request([2]))[0]; videoIds.add(task.id); await waitVideo(task.id, "completed", 60000);
    await stopMedia(); await offlinePlay("open_downloaded_video", { id: task.id }, ruleMedia[2], "hls-vod-offline-libmpv"); await startMedia();
  }
  throttle = true;
  const job = await invoke("enqueue_file_download", { mediaFileId: davFile.id }); jobIds.add(job.id);
  const sameJob = await invoke("enqueue_file_download", { mediaFileId: davFile.id }); assert.equal(sameJob.id, job.id);
  await wait(jobs, rows => rows.some(row => row.id === job.id && row.state === "downloading" && row.bytesDownloaded > 32768), "WebDAV durable progress", 60000);
  await invoke("control_download_job", { id: job.id, action: "pause" }); await waitJob(job.id, "paused");
  throttle = false; await invoke("control_download_job", { id: job.id, action: "resume" });
  const fileCompleted = await waitJob(job.id, "completed"); assert.equal(fileCompleted.bytesDownloaded, media.length); assert.equal(fileCompleted.mediaFileId, davFile.id);
  assert.ok(result.requests.media.some(request => request.path === `/dav/${fileName}` && /^bytes=[1-9]\d*-/.test(request.range || "")), "WebDAV resume should use a nonzero verified Range");
  result.cases.webdavDurableQueueAndVerifiedResume = { mediaId: davFile.id, bytesDownloaded: fileCompleted.bytesDownloaded };
  await stopMedia(); await offlinePlay("open_downloaded_file", { mediaFileId: davFile.id }, davFile.id, "webdav-offline-libmpv");
  await showDownloadCenter("download-center-video-and-file");
  assert.ok(result.requests.media.filter(request => request.path.startsWith("/rule/")).every(request => request.headersAccepted));
  assert.ok(result.requests.media.filter(request => request.path.startsWith("/dav/")).every(request => request.authorized));
  result.cases.configuredRuleHeadersAndWebdavAuthorization = true;
  result.passed = true;
} catch (error) { failure = error; result.error = String(error); try { shot("failure"); } catch {} }
finally {
  try { await cleanup(); } catch (error) { result.cleanupError = String(error); result.passed = false; failure ||= error; }
  await browser?.close().catch(() => {});
  try { command("forward", "--remove", `tcp:${cdpPort}`); } catch {}
  for (const port of [catalogPort, mediaPort].filter(Boolean)) { try { command("reverse", "--remove", `tcp:${port}`); } catch {} }
  try { command("shell", "rm", "-f", `/data/local/tmp/genzo-downloads-${run}.xml`); } catch {}
  await stopMedia();
  if (catalogServer) { catalogServer.closeAllConnections(); await new Promise(resolve => catalogServer.close(resolve)); }
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed === true, output, cases: result.cases, skipped: result.skipped, error: result.error, cleanupError: result.cleanupError }));
}
if (failure) throw failure;
