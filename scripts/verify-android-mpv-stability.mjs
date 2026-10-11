import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const output = `D:/DevTools/Android/Build/qa/mpv-smoke-${Date.now()}`; mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const media = readFileSync("D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4");
const run = Date.now(), fileName = `GenzoMpvSmoke-${run}.mp4`;
const authHeader = `Basic ${Buffer.from("qa:mpv-fixture").toString("base64")}`;
let davStatus = 200;
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/stall") return;
  if (path.startsWith("/dav") && req.headers.authorization !== authHeader) { res.writeHead(401); res.end(); return; }
  if (req.method === "PROPFIND") {
    const item = (href, folder) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${folder ? "<d:collection/>" : ""}</d:resourcetype>${folder ? "" : `<d:getcontentlength>${media.length}</d:getcontentlength><d:getetag>mpv-${run}</d:getetag>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    res.writeHead(207, { "Content-Type": "application/xml" }); res.end(`<d:multistatus xmlns:d="DAV:">${item("/dav/", true)}${item(`/dav/${fileName}`, false)}</d:multistatus>`); return;
  }
  if (path.startsWith("/dav/") && req.method !== "HEAD" && req.headers.range !== "bytes=0-0" && davStatus !== 200) { res.writeHead(davStatus); res.end(); return; }
  if (path === "/invalid") { res.writeHead(200, { "Content-Type": "video/mp4" }); res.end("Own invalid media fixture"); return; }
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
  res.writeHead(match ? 206 : 200, { "Content-Type": "video/mp4", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(match ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}) });
  res.end(req.method === "HEAD" ? undefined : media.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port; cmd("reverse", `tcp:${port}`, `tcp:${port}`);
let browser, page, guarded = false, sessionId, original, sourceId;
const result = { output, cases: {}, snapshots: {} };
async function invoke(name, args = {}) {
  let timer;
  try { return await Promise.race([page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Native RPC timeout: ${name}`)), 12000); })]); }
  finally { clearTimeout(timer); }
}
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const control = (action, extra = {}) => native("playerControl", { action, sessionId, ...extra });
async function until(accept, label, timeout = 35000) {
  const end = Date.now() + timeout; let state;
  while (Date.now() < end) { state = await native("playerState"); if (accept(state)) return state; await delay(150); }
  throw new Error(`${label}: ${JSON.stringify(state)}`);
}
async function open(path = "/video", resumeMs = 0) {
  sessionId = randomUUID(); await native("openPlayer", { uri: `http://127.0.0.1:${port}${path}`, sessionId, resumeMs });
}
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
function dump() { cmd("shell", "uiautomator", "dump", "/data/local/tmp/genzo-mpv-smoke.xml"); return cmd("shell", "cat", "/data/local/tmp/genzo-mpv-smoke.xml"); }
function tap(xml, text) {
  const node = [...xml.matchAll(/<node\b[^>]*>/g)].find(match => match[0].includes(`text="${text}"`))?.[0]; assert.ok(node, text);
  const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node); assert.ok(b);
  cmd("shell", "input", "tap", String((Number(b[1]) + Number(b[3])) >> 1), String((Number(b[2]) + Number(b[4])) >> 1));
}
try {
  cmd("shell", "input", "keyevent", "KEYCODE_WAKEUP"); cmd("shell", "wm", "dismiss-keyguard"); cmd("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1500);
  const pid = cmd("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/); cmd("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true, timeout: 8000 }); page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`); guarded = true;
  original = await invoke("get_android_playback_preferences"); await invoke("set_android_playback_preferences", { settings: { hardwareDecoding: true, hardwareDecoder: "mediacodec-copy", videoRenderer: "gpu", superResolution: 0 } });
  await open(); const ordinary = await until(s => s.sessionId === sessionId && s.status === "playing" && s.positionMs > 500, "ordinary mpv");
  assert.equal(ordinary.engine, "libmpv"); assert.equal(ordinary.shaderCount, 0); shot("ordinary"); result.cases.ordinaryPlayback = true;
  await control("pause"); await control("seek", { value: 8000 }); await control("superResolution", { value: 1 });
  const superState = await until(s => s.status === "paused" && s.superResolution === 1 && s.shaderPasses.some(p => p.includes("Anime4K")), "paused shader switch");
  assert.ok(Math.abs(superState.positionMs - 8000) < 500); shot("super-resolution"); result.cases.pausedSwitchKeepsPosition = true;
  await open("/invalid"); const invalid = await until(s => s.sessionId === sessionId && s.status === "playback_error", "format error");
  assert.equal(invalid.error.code, "unsupported_media"); await delay(1100); assert.equal((await native("playerState")).status, "playback_error"); result.cases.invalidFormatIsStickyAndActionable = true;
  await control("close");
  sourceId = await invoke("add_webdav_source", { input: { name: `QA MPV ${run}`, endpoint: `http://127.0.0.1:${port}`, directory: "/dav/", username: "qa", password: "mpv-fixture", kind: "video" } });
  let file;
  for (let i = 0; i < 100 && !file; i++) { file = (await invoke("list_unassigned_media", { destination: "media" })).find(f => f.libraryRootId === sourceId); if (!file) await delay(300); }
  assert.ok(file, "own WebDAV fixture indexed");
  const openDav = async status => { davStatus = status; sessionId = (await invoke("open_internal_player", { mediaFileId: file.id, restart: true, subtitleId: null })).sessionId; };
  await openDav(401); const auth = await until(s => s.sessionId === sessionId && s.error?.code === "credential_invalid", "authentication error through production proxy");
  assert.ok(!JSON.stringify(auth).includes("mpv-fixture"));
  tap(dump(), "错误详情"); const detail = dump(); assert.ok(detail.includes("credential_invalid")); assert.ok(!detail.includes("mpv-fixture")); assert.ok(!detail.includes("127.0.0.1")); shot("failure-details"); cmd("shell", "input", "keyevent", "KEYCODE_BACK"); result.cases.authenticationAndPrivateDiagnostics = true;
  await control("close"); await openDav(404); await until(s => s.sessionId === sessionId && s.error?.code === "source_missing", "missing media"); result.cases.missingAddressExplained = true;
  await control("close"); await openDav(503); await until(s => s.sessionId === sessionId && s.error?.code === "source_offline", "network error");
  davStatus = 200; tap(dump(), "重试播放"); const recovered = await until(s => s.sessionId === sessionId && s.status === "playing" && s.positionMs > 500, "manual retry"); assert.equal(recovered.error, undefined); assert.equal(recovered.failed, false);
  assert.equal((await invoke("get_internal_player_state", { sessionId })).error, null); result.cases.actualRetryButtonRecoversNetworkFailure = true;
  await control("close"); await delay(700);
  for (let i = 0; i < 5; i++) {
    await open(); await until(s => s.sessionId === sessionId && s.status === "playing" && s.positionMs > 100, `replacement ${i}`);
    await delay(200); assert.equal((await native("playerState")).sessionId, sessionId);
  }
  assert.equal(cmd("shell", "pidof", app).trim(), pid); result.cases.repeatedReplacementKeepsNewestSession = true;
  await control("close"); await native("playerControl", { action: "close" });
  sessionId = randomUUID(); await native("openPlayer", { loading: true, sessionId });
  const loading = await until(s => s.sessionId === sessionId, "loading shell"); assert.equal(loading.engineInitialized, false); assert.equal(loading.engine, undefined);
  const closeAt = Date.now(); await control("close"); await native("playerControl", { action: "close" }); assert.ok(Date.now() - closeAt < 2500); result.cases.loadingShellDoesNotCreateDecoder = true;
  await open("/stall"); await until(s => s.sessionId === sessionId && s.engineInitialized, "network opening");
  const stopAt = Date.now(); await control("close"); await native("playerControl", { action: "close" }); const stopMs = Date.now() - stopAt;
  assert.ok(stopMs < 3000, `slow network blocks main thread for ${stopMs}ms`); result.snapshots.slowNetworkCloseMs = stopMs; result.cases.slowNetworkCanExitPromptly = true;
  console.log(JSON.stringify({ output, cases: result.cases, ...result.snapshots }));
} catch (error) { result.error = String(error); shot("failure"); throw error; }
finally {
  if (guarded) {
    await native("playerControl", { action: "close" }).catch(() => {});
    if (original) await invoke("set_android_playback_preferences", { settings: original }).catch(() => {});
    if (sourceId) {
      for (let i = 0; i < 100; i++) { const tasks = await invoke("list_source_imports"); if (!tasks.some(t => t.sourceIds.includes(sourceId) && ["queued", "scanning", "recognizing", "enriching"].includes(t.stage))) break; await delay(300); }
      await invoke("remove_webdav_source", { id: sourceId });
    }
    cmd("shell", "rm", "-f", "/data/local/tmp/genzo-mpv-smoke.xml");
  }
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser?.close(); cmd("forward", "--remove", "tcp:9346"); cmd("reverse", "--remove", `tcp:${port}`); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
