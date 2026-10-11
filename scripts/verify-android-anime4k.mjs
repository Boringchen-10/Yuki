import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000";
const app = "com.genzo.android.organizeqa", output = `D:/DevTools/Android/Build/qa/anime4k-${Date.now()}`;
mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const shot = name => {
  const path = `${output}/${name}.png`;
  writeFileSync(path, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  if (["quality-paused", "local-subtitle-quality", "picker-return", "landscape", "embedded-ass"].includes(name)) {
    // Our generated color bars must occupy a substantial part of the screen.
    // A 'playing' state alone cannot detect a blank or incorrectly resized Surface.
    const fraction = Number(execFileSync("C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe", ["-c", "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGB').resize((160,160)); print(sum(max(p)-min(p)>80 and max(p)>100 for p in im.get_flattened_data())/25600)", path], { encoding: "utf8" }));
    assert.ok(fraction > 0.1, `${name}: missing/clipped actual video frame (${fraction})`);
  }
};
const media = readFileSync(process.env.ANIME4K_SAMPLE || "D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4");
const requests = [];
const run = Date.now(), fileName = `GenzoAnime4kQA-${run}.mp4`, subtitleName = `GenzoAnime4kQA-${run}.srt`;
const tracksName = `GenzoAnime4kQA-${run}.mkv`;
const hlsDirectory = "D:/DevTools/Android/Build/qa/kazumi-rules-20261010/hls";
const auth = `Basic ${Buffer.from("qa:anime4k-fixture").toString("base64")}`;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  requests.push({ path, method: req.method, range: req.headers.range });
  if (path.startsWith("/dav") && req.headers.authorization !== auth) { res.writeHead(401); res.end(); return; }
  if (req.method === "PROPFIND") {
    const item = (href, folder) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${folder ? "<d:collection/>" : ""}</d:resourcetype>${folder ? "" : `<d:getcontentlength>${media.length}</d:getcontentlength><d:getetag>a4k-${run}</d:getetag>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    res.writeHead(207, { "Content-Type": "application/xml" }); res.end(`<d:multistatus xmlns:d="DAV:">${item("/dav/", true)}${item(`/dav/${fileName}`, false)}</d:multistatus>`); return;
  }
  if (path === "/rule/detail") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end('<div class="road"><a href="/rule/play">第1集</a></div>'); return; }
  if (path === "/rule/play") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end('<video controls src="/hls/media.m3u8"></video>'); return; }
  if (path === "/invalid.mp4") { res.writeHead(200, { "Content-Type": "video/mp4" }); res.end("Own invalid media fixture"); return; }
  const body = path.startsWith("/hls/") ? readFileSync(`${hlsDirectory}/${path.split("/").at(-1)}`) : media;
  const mime = path.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : path.endsWith(".ts") ? "video/mp2t" : "video/mp4";
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
  if (start > end) { res.writeHead(416); res.end(); return; }
  res.writeHead(match ? 206 : 200, { "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(match ? { "Content-Range": `bytes ${start}-${end}/${body.length}` } : {}) });
  res.end(req.method === "HEAD" ? undefined : body.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
command("reverse", `tcp:${port}`, `tcp:${port}`);
let browser, page, guarded = false;
const result = { output, cases: {}, snapshots: {} };
let sourceId, pluginId;
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
async function until(accept, label, timeout = 35000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await native("playerState"); if (accept(last)) return last; await delay(250); }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}
async function waitRead(read, accept, label, timeout = 35000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await delay(300); }
  throw new Error(`Timed out: ${label}`);
}
const close = async () => { await native("playerControl", { action: "close" }); await until(s => s.status === "closed", "closed"); await delay(500); };
const gpu = async label => {
  const state = await until(s => s.engine?.includes("mpv") && s.status === "playing" && s.positionMs > 500 && s.shaderPasses?.some(p => p.includes("Upscale-CNN")), label);
  result.snapshots[label] = state; assert.equal(state.superResolutionFallback, undefined); return state;
};
try {
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); command("shell", "wm", "dismiss-keyguard");
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1500);
  const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
  command("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true, timeout: 8000 });
  page = browser.contexts()[0].pages().find(candidate => candidate.url().includes("tauri.localhost")); assert.ok(page);
  const info = await invoke("get_app_info"); assert.equal(info.dataDirectory, `/data/user/0/${app}`);
  guarded = true;
  result.cases.isolatedPackage = true;
  // Own cache fixtures only; the FileProvider opens the same content FD path used by SAF.
  writeFileSync(`${output}/${fileName}`, media); writeFileSync(`${output}/${subtitleName}`, "1\n00:00:00,000 --> 00:00:39,000\nGenzo Anime4K 字幕测试\n");
  writeFileSync(`${output}/${tracksName}`, readFileSync("D:/DevTools/Android/Samples/GenzoPrototype/h264-tracks.mkv"));
  command("shell", "run-as", app, "mkdir", "-p", "player-subtitles");
  for (const name of [fileName, subtitleName, tracksName]) {
    command("push", `${output}/${name}`, `/data/local/tmp/${name}`);
    command("shell", "run-as", app, "cp", `/data/local/tmp/${name}`, name === subtitleName ? `player-subtitles/${name}` : `cache/${name}`);
  }
  const sessionId = randomUUID();
  await native("openPlayer", { uri: `http://127.0.0.1:${port}/video.mp4`, sessionId, resumeMs: 0 });
  await until(s => s.sessionId === sessionId && s.status === "playing" && s.positionMs > 500, "initial playback");
  await native("playerControl", { action: "superResolution", value: 0, sessionId });
  result.snapshots.initial = await until(s => s.engine === "LibVLC 3.7.7" && s.status === "playing", "ordinary playback"); result.cases.libVlcRetained = true;
  await native("playerControl", { action: "superResolution", value: 1, sessionId });
  result.snapshots.fast = await gpu("fast");
  await delay(1500); await native("playerControl", { action: "pause", sessionId });
  result.snapshots.fastPaused = await until(s => s.status === "paused", "pause"); shot("fast");
  assert.equal(result.snapshots.fast.superResolution, 1); assert.equal(result.snapshots.fast.shaderCount, 6);
  assert.equal(result.snapshots.fast.gpuRenderer, "gpu"); result.cases.nativeGpuAnime4K = true;
  await native("playerControl", { action: "seek", value: 8000, sessionId });
  await until(s => s.status === "paused" && Math.abs(s.positionMs - 8000) < 300, "paused exact seek");
  await native("playerControl", { action: "rate", value: 1.5, sessionId });
  await native("playerControl", { action: "audio", value: -1, sessionId });
  await native("playerControl", { action: "superResolution", value: 2, sessionId });
  result.snapshots.qualityPaused = await until(s => s.superResolution === 2 && s.status === "paused" && s.shaderPasses?.some(p => p.includes("(VL)")), "quality while paused");
  assert.ok(Math.abs(result.snapshots.qualityPaused.positionMs - 8000) < 300); assert.equal(result.snapshots.qualityPaused.rate, 1.5); assert.equal(result.snapshots.qualityPaused.audioTrack, -1);
  await delay(800); shot("quality-paused"); result.cases.qualityRestoresPauseSeekRateAudio = true;
  await native("playerControl", { action: "superResolution", value: 0, sessionId });
  result.snapshots.offPaused = await until(s => s.engine === "LibVLC 3.7.7" && s.status === "paused" && Math.abs(s.positionMs - 8000) < 700, "off preserves paused position");
  result.cases.offReturnsToVlcAtSamePosition = true;
  await native("playerControl", { action: "superResolution", value: 1, sessionId });
  await native("playerControl", { action: "play", sessionId }); await gpu("fast-after-off"); await close();
  const localSession = randomUUID();
  await native("openPlayer", { uri: `content://${app}.fileprovider/my_cache_images/${fileName}`, sessionId: localSession, resumeMs: 8000, subtitleFile: `/data/user/0/${app}/player-subtitles/${subtitleName}`, subtitleId: "qa-anime4k-sidecar", subtitleLabel: "Anime4K QA" });
  await gpu("local-content-fd");
  await until(s => s.selectedSidecar === "qa-anime4k-sidecar", "sidecar selected");
  await native("playerControl", { action: "subtitleOffset", value: 500, sessionId: localSession });
  await native("playerControl", { action: "pause", sessionId: localSession });
  await until(s => s.status === "paused", "local paused");
  await native("playerControl", { action: "superResolution", value: 2, sessionId: localSession });
  const sub = await until(s => s.status === "paused" && s.superResolution === 2 && s.selectedSidecar === "qa-anime4k-sidecar" && s.subtitleOffsetMs === 500, "sidecar restored across engines");
  assert.ok(sub.subtitleTracks.some(track => track.id === "qa-anime4k-sidecar")); await delay(1000); shot("local-subtitle-quality"); result.cases.localFdAndExternalSubtitle = true;
  await native("playerControl", { action: "landscape", sessionId: localSession }); await delay(1000); shot("landscape");
  assert.equal((await native("playerState")).superResolution, 2);
  await native("playerControl", { action: "portrait", sessionId: localSession }); await delay(800); result.cases.orientationKeepsShader = true;
  const picker = invoke("pick_external_subtitle", { sessionId: localSession });
  await delay(1000); command("shell", "input", "keyevent", "KEYCODE_BACK");
  assert.equal((await picker).status, "cancelled");
  await until(s => s.sessionId === localSession && s.superResolution === 2 && s.status === "paused", "system picker returns to paused GPU player");
  await delay(700); shot("picker-return"); result.cases.systemPickerCancelKeepsGpuPause = true;
  await native("playerControl", { action: "superResolution", value: 1, sessionId: localSession }); await close();
  const tracksSession = randomUUID();
  await native("openPlayer", { uri: `content://${app}.fileprovider/my_cache_images/${tracksName}`, sessionId: tracksSession, resumeMs: 8000 });
  const tracks = await gpu("local-mkv-tracks");
  assert.equal(tracks.audioTracks.filter(t => t.id > 0).length, 2); assert.ok(tracks.subtitleTracks.some(t => t.id > 0));
  const audioId = tracks.audioTracks.filter(t => t.id > 0)[1].id, subtitleId = tracks.subtitleTracks.find(t => t.id > 0).id;
  await native("playerControl", { action: "audio", value: audioId, sessionId: tracksSession });
  await native("playerControl", { action: "subtitle", value: subtitleId, sessionId: tracksSession });
  await native("playerControl", { action: "seek", value: 8000, sessionId: tracksSession });
  await until(s => s.audioTrack === audioId && s.subtitleTrack === subtitleId, "embedded track selection");
  await delay(1000); await native("playerControl", { action: "pause", sessionId: tracksSession }); shot("embedded-ass");
  result.cases.mkvMultipleAudioAndEmbeddedAss = true; await close();
  pluginId = await invoke("import_rule_plugin", { definition: { api: "8", name: `QA Anime4K ${run}`, version: "1", baseURL: `http://127.0.0.1:${port}`, searchURL: `http://127.0.0.1:${port}/rule/search?q=@keyword`, searchList: "//a", searchName: ".", searchResult: ".", chapterRoads: "//div[@class='road']", chapterResult: "//a", useWebview: true, useLegacyParser: false }, origin: null });
  const rule = await invoke("preview_rule_episode", { pluginId, source: `http://127.0.0.1:${port}/rule/detail`, roadIndex: 0, episodeIndex: 0 });
  await gpu("rule-hls"); assert.ok(rule.sessionId); result.cases.rulesHlsUsesSameShader = true; await close();
  sourceId = await invoke("add_webdav_source", { input: { name: `QA Anime4K ${run}`, endpoint: `http://127.0.0.1:${port}`, directory: "/dav/", username: "qa", password: "anime4k-fixture", kind: "video" } });
  const files = await waitRead(() => invoke("list_unassigned_media", { destination: "media" }), files => files.some(f => f.libraryRootId === sourceId), "DAV scan");
  const file = files.find(f => f.libraryRootId === sourceId); assert.ok(file);
  const dav = await invoke("open_internal_player", { mediaFileId: file.id, restart: true, subtitleId: null });
  await gpu("webdav-auth-range");
  await invoke("control_internal_player", { sessionId: dav.sessionId, action: { type: "seek", positionMs: 17000 } });
  await until(s => s.positionMs >= 16000, "DAV seek"); await invoke("control_internal_player", { sessionId: dav.sessionId, action: { type: "pause" } });
  await until(s => s.status === "paused", "DAV paused"); await close();
  const reopened = await invoke("open_internal_player", { mediaFileId: file.id, restart: false, subtitleId: null }); await gpu("webdav-resumed");
  assert.ok((await native("playerState")).positionMs >= 16000); result.cases.webdavAuthSeekResume = true;
  await invoke("control_internal_player", { sessionId: reopened.sessionId, action: { type: "super-resolution", mode: 0 } });
  await until(s => s.superResolution === 0 && s.engine === "LibVLC 3.7.7", "public shader control"); result.cases.publicSessionControl = true;
  await native("playerControl", { action: "superResolution", value: 1 }); await gpu("final-fast"); await close();
  await native("openPlayer", { uri: `http://127.0.0.1:${port}/invalid.mp4`, sessionId: randomUUID(), resumeMs: 0 });
  const failed = await until(s => s.engine === "LibVLC 3.7.7" && s.status === "playback_error" && s.superResolutionFallback, "mpv runtime failure falls back once");
  result.snapshots.fallback = failed; result.cases.runtimeFallback = true; await close();
  await native("openPlayer", { uri: `http://127.0.0.1:${port}/video.mp4`, sessionId: randomUUID(), resumeMs: 0 }); await gpu("next-session-after-fallback");
  result.cases.fallbackDoesNotDisableNextSessionPreference = true;
  await close();
  await native("openPlayer", { uri: `http://127.0.0.1:${port}/invalid.mp4`, sessionId: randomUUID(), resumeMs: 0 });
  await until(s => s.superResolution === 0 && s.superResolutionFallback, "second fallback");
  await native("playerControl", { action: "superResolution", value: 0 }); await close();
  await native("openPlayer", { uri: `http://127.0.0.1:${port}/video.mp4`, sessionId: randomUUID(), resumeMs: 0 });
  await until(s => s.engine === "LibVLC 3.7.7" && s.status === "playing", "explicit off after fallback persists");
  result.cases.explicitOffAfterFallbackPersists = true;
  await native("playerControl", { action: "superResolution", value: 1 }); await gpu("restore-fast-for-regression");
  await close(); assert.ok(!requests.some(request => request.method === "DELETE"));
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, cases: result.cases }, null, 2));
} catch (error) { result.error = String(error); shot("failure"); throw error; }
finally {
  if (page && guarded) await native("playerControl", { action: "close" }).catch(() => {});
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  if (pluginId) await invoke("remove_rule_plugin", { id: pluginId }).catch(() => {});
  if (sourceId) {
    await waitRead(() => invoke("list_source_imports"), tasks => !tasks.some(t => t.sourceIds.includes(sourceId) && ["queued", "scanning", "recognizing", "enriching"].includes(t.stage)), "DAV background import", 90000).catch(() => {});
    await invoke("remove_webdav_source", { id: sourceId }).catch(() => {});
  }
  for (const name of [fileName, subtitleName, tracksName]) {
    command("shell", "rm", "-f", `/data/local/tmp/${name}`);
    command("shell", "run-as", app, "rm", "-f", name === subtitleName ? `player-subtitles/${name}` : `cache/${name}`);
  }
  command("reverse", "--remove", `tcp:${port}`); command("forward", "--remove", "tcp:9346");
  await browser?.close(); server.close();
}
