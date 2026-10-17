import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

// Intentionally fixed: never run this synthetic test against a daily/release profile.
const app = "com.genzo.android.organizeqa", serial = "3B164M00Z0500000";
const expectedData = `/data/user/0/${app}`, cdpPort = 9358;
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const python = "C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const ffmpeg = "D:/DevTools/Android/TestTools/ffmpeg/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe";
const run = Date.now(), title = `GenzoWebdavLatencyQA-${run}`, fileName = `${title}-01.mp4`;
const output = `D:/DevTools/Android/Build/qa/webdav-latency-20261017/${run}`;
mkdirSync(output, { recursive: true });
const result = { app, serial, output, cases: {}, requests: { gateway: [], cdn: [] }, cleanup: [] };
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
const deviceBytes = (...args) => execFileSync(adb, ["-s", serial, ...args], { timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
const ownFileExists = path => { try { command("shell", "run-as", app, "ls", path); return true; } catch (error) { if (String(error.stderr).includes("No such file")) return false; throw error; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const activeImport = task => ["queued", "scanning", "recognizing", "enriching"].includes(task.stage);
let browser, page, info, guarded = false, sourceId, mediaId, sessionId, engine, originalPreferences;
let gateway, cdn, gatewayPort, cdnPort, ticket = 1, media, failure;
let forwardOwned = false;
const importIds = new Set(), originalPlayerFiles = new Map(), reversedPorts = new Set();

async function invoke(name, args = {}) {
  let timer;
  try {
    return await Promise.race([page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`QA RPC timeout: ${name}`)), 20000); })]);
  } finally { clearTimeout(timer); }
}
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const control = (action, extra = {}) => native("playerControl", { action, sessionId, ...extra });
async function wait(read, accept, label, timeout = 20000) {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await read(); if (accept(value)) return value; await delay(150); }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
async function connect() {
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await delay(500);
      const pid = command("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
      if (!forwardOwned) assert.ok(!command("forward", "--list").split("\n").some(line => line.split(/\s+/)[1] === `tcp:${cdpPort}`), "Do not replace an existing CDP mapping");
      command("forward", `tcp:${cdpPort}`, `localabstract:webview_devtools_remote_${pid}`);
      forwardOwned = true;
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { noDefaults: true, timeout: 4000 });
      page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost")); assert.ok(page);
      info = await invoke("get_app_info");
      assert.equal(info.dataDirectory, expectedData); assert.equal(info.databasePath, `${expectedData}/genzo.db`);
      assert.equal(info.version, "0.17.0", "Install the final QA build before running this script");
      guarded = true; return;
    } catch (error) { last = error; await browser?.close().catch(() => {}); browser = null; }
  }
  throw last;
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}
function sendMedia(req, res, record) {
  let start = 0, end = media.length - 1;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || !range[1] && !range[2]) { res.writeHead(416); res.end(); return; }
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    else start = Math.max(0, media.length - Number(range[2]));
    if (start > end || start >= media.length) { res.writeHead(416, { "Content-Range": `bytes */${media.length}` }); res.end(); return; }
  }
  record.status = req.headers.range ? 206 : 200; record.start = start; record.end = end;
  res.writeHead(record.status, { "Content-Type": "video/mp4", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Set-Cookie": "synthetic-cdn=never-forward", ...(req.headers.range ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}) });
  if (req.method === "HEAD") { res.end(); return; }
  // Keep unread portions outside mpv's cache so both seeks actually exercise HTTP.
  let offset = start, timer;
  const next = () => {
    if (res.destroyed) return;
    const limit = Math.min(offset + 32768, end + 1);
    res.write(media.subarray(offset, limit)); offset = limit;
    if (offset > end) res.end(); else timer = setTimeout(next, 50);
  };
  res.once("close", () => clearTimeout(timer)); next();
}
function screenshot(name) {
  const foreground = command("shell", "dumpsys", "activity", "activities").split("\n").find(line => line.includes("topResumedActivity"));
  assert.ok(foreground?.includes(app), "Only capture the foreground synthetic QA app");
  writeFileSync(`${output}/${name}.png`, deviceBytes("exec-out", "screencap", "-p"));
}
async function cancelOwnImports() {
  if (!sourceId) return;
  const own = (await invoke("list_source_imports")).filter(task => task.sourceIds.includes(sourceId));
  for (const task of own) { importIds.add(task.id); if (activeImport(task)) await invoke("cancel_source_import", { id: task.id }).catch(() => {}); }
  await wait(() => invoke("list_source_imports"), tasks => !tasks.some(task => task.sourceIds.includes(sourceId) && activeImport(task)), "stop own source import", 20000);
}
async function seek(target, label) {
  const before = result.requests.cdn.length, started = Date.now();
  await control("seek", { value: target }); await control("play");
  const state = await wait(() => native("playerState"), state => state.sessionId === sessionId && state.status === "playing" && state.positionMs >= target + 150 && state.positionMs < target + 3000, `${label} decoded playback`);
  assert.equal(state.engineInstance, engine); assert.equal(state.mediaFileId, mediaId);
  assert.ok(result.requests.cdn.slice(before).some(request => request.status === 206 && request.start > 0), `${label} must fetch an uncached nonzero range`);
  await control("pause");
  return { targetMs: target, positionMs: state.positionMs, elapsedMs: Date.now() - started, engineInstance: engine };
}
async function cleanup() {
  if (!guarded) return;
  assert.equal((await invoke("get_app_info")).dataDirectory, expectedData);
  if (sessionId && (await native("playerState")).sessionId === sessionId) {
    await control("close"); await delay(800);
  }
  await cancelOwnImports();
  if (sourceId) {
    const source = (await invoke("list_remote_sources")).find(source => source.id === sourceId);
    assert.equal(source?.name, title); assert.equal(source.endpoint, `http://127.0.0.1:${gatewayPort}/`);
    await invoke("remove_webdav_source", { id: sourceId }); result.cleanup.push("removed only own source credentials");
  }
  if (originalPreferences) await invoke("set_android_playback_preferences", { settings: originalPreferences });
  await browser.close(); browser = null;
  command("shell", "am", "force-stop", app);
  if (!sourceId) return;
  // The product removal API deliberately retains media/progress. Delete only our
  // exact synthetic IDs from this guarded, stopped QA database, preserving all other rows.
  writeFileSync(`${output}/genzo.db`, deviceBytes("exec-out", "run-as", app, "cat", "genzo.db"));
  for (const suffix of ["-wal", "-shm"]) {
    if (ownFileExists(`genzo.db${suffix}`)) writeFileSync(`${output}/genzo.db${suffix}`, deviceBytes("exec-out", "run-as", app, "cat", `genzo.db${suffix}`));
  }
  writeFileSync(`${output}/owned.json`, JSON.stringify({ app, expectedData, title, fileName, sourceId, mediaId, importIds: [...importIds] }));
  const clean = String.raw`import json, sqlite3, sys
from pathlib import Path
folder=Path(sys.argv[1]); own=json.loads((folder/'owned.json').read_text())
assert own['app']=='com.genzo.android.organizeqa' and own['expectedData']=='/data/user/0/com.genzo.android.organizeqa'
db=sqlite3.connect(folder/'genzo.db'); db.execute('PRAGMA wal_checkpoint(TRUNCATE)'); db.execute('PRAGMA foreign_keys=ON')
source=own['sourceId']; rows=db.execute('SELECT id,file_name,work_id FROM media_files WHERE library_root_id=?',(source,)).fetchall()
assert all(name==own['fileName'] and work is None for _,name,work in rows), 'Unexpected synthetic source ownership'
assert db.execute('SELECT name FROM remote_sources WHERE id=?',(source,)).fetchone()[0]==own['title']
before=db.execute('SELECT COUNT(*) FROM works').fetchone()[0]
for media,_,_ in rows:
 db.execute('DELETE FROM sync_viewing_sessions WHERE media_file_id=?',(media,))
 db.execute('DELETE FROM media_files WHERE id=? AND library_root_id=?',(media,source))
 assert not db.execute('SELECT 1 FROM playback_progress WHERE media_file_id=?',(media,)).fetchone()
db.execute('DELETE FROM remote_sources WHERE id=?',(source,)); db.execute('DELETE FROM library_roots WHERE id=?',(source,))
for task in own['importIds']:
 db.execute('DELETE FROM app_settings WHERE key IN (?,?)',('android.source_import.task.'+task,'android.source_import.queue.'+task))
db.commit(); db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
assert db.execute('SELECT COUNT(*) FROM works').fetchone()[0]==before
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
db.close(); print(json.dumps({'removedMedia':len(rows),'retainedWorks':before,'integrity':'ok'}))
`;
  result.cleanupDatabase = JSON.parse(execFileSync(python, ["-c", clean, output], { encoding: "utf8", timeout: 20000 }));
  const upload = (host, target) => {
    const temporary = `/data/local/tmp/${title}-${target.split("/").at(-1)}`;
    command("push", host, temporary); command("shell", "run-as", app, "cp", temporary, target); command("shell", "rm", "-f", temporary);
  };
  command("shell", "run-as", app, "rm", "-f", "genzo.db-wal", "genzo.db-shm"); upload(`${output}/genzo.db`, "genzo.db");
  for (const [name, original] of originalPlayerFiles) {
    const target = `shared_prefs/${name}.xml`;
    if (original) { writeFileSync(`${output}/${name}-restore.xml`, original); upload(`${output}/${name}-restore.xml`, target); }
    else command("shell", "run-as", app, "rm", "-f", target);
  }
  result.cleanup.push("removed own media/index/progress/import tasks; restored QA player preferences");
}

try {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-g", "24", "-c:a", "aac", "-movflags", "+faststart", `${output}/synthetic-40s.mp4`], { timeout: 45000, stdio: "pipe" });
  media = readFileSync(`${output}/synthetic-40s.mp4`); result.syntheticBytes = media.length;
  cdn = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const record = { at: Date.now(), method: req.method, range: req.headers.range || null, ticket: Number(url.searchParams.get("ticket")), authorizationPresent: !!req.headers.authorization, cookiePresent: !!req.headers.cookie };
    result.requests.cdn.push(record);
    if (record.ticket !== ticket) { record.status = 403; res.writeHead(403, { "Content-Length": 0 }); res.end(); return; }
    sendMedia(req, res, record);
  });
  cdnPort = await listen(cdn);
  const auth = `Basic ${Buffer.from("qa:synthetic-webdav-latency").toString("base64")}`;
  gateway = createServer((req, res) => {
    const authorized = req.headers.authorization === auth;
    const record = { at: Date.now(), method: req.method, range: req.headers.range || null, authorized };
    result.requests.gateway.push(record);
    if (!authorized) { res.writeHead(401, { "Content-Length": 0 }); res.end(); return; }
    if (req.method === "PROPFIND") {
      const entry = (href, directory) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype>${directory ? "" : `<d:getcontentlength>${media.length}</d:getcontentlength><d:getetag>synthetic-${run}</d:getetag>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      res.writeHead(207, { "Content-Type": "application/xml" }); res.end(`<d:multistatus xmlns:d="DAV:">${entry("/dav/", true)}${entry(`/dav/${fileName}`, false)}</d:multistatus>`); return;
    }
    record.ticket = ticket;
    setTimeout(() => { if (!res.destroyed) { res.writeHead(302, { "Content-Length": 0, Location: `http://127.0.0.1:${cdnPort}/synthetic.mp4?ticket=${ticket}` }); res.end(); } }, 250);
  });
  gatewayPort = await listen(gateway);
  for (const port of [gatewayPort, cdnPort]) {
    assert.ok(!command("reverse", "--list").split("\n").some(line => line.split(/\s+/).includes(`tcp:${port}`)), "Do not replace an existing reverse mapping");
    command("reverse", `tcp:${port}`, `tcp:${port}`); reversedPorts.add(port);
  }
  await connect();
  assert.equal((await invoke("sync_status")).connected, false, "Use an unconnected synthetic QA profile; never upload test progress");
  originalPreferences = await invoke("get_android_playback_preferences");
  for (const name of ["genzo-player", "genzo-prototype-progress"]) {
    const present = ownFileExists(`shared_prefs/${name}.xml`);
    originalPlayerFiles.set(name, present ? deviceBytes("exec-out", "run-as", app, "cat", `shared_prefs/${name}.xml`) : null);
  }
  await invoke("set_android_playback_preferences", { settings: { hardwareDecoding: true, hardwareDecoder: "mediacodec-copy", videoRenderer: "gpu", superResolution: 0 } });
  sourceId = await invoke("add_webdav_source", { input: { name: title, endpoint: `http://127.0.0.1:${gatewayPort}`, directory: "/dav/", username: "qa", password: "synthetic-webdav-latency", kind: "video" } });
  const files = await wait(() => invoke("list_unassigned_media", { destination: "media" }), files => files.some(file => file.libraryRootId === sourceId && file.fileName === fileName), "own synthetic scan");
  mediaId = files.find(file => file.libraryRootId === sourceId && file.fileName === fileName).id;
  await cancelOwnImports();
  const started = Date.now();
  sessionId = (await invoke("open_internal_player", { mediaFileId: mediaId, restart: true, subtitleId: null })).sessionId;
  const frame = await wait(() => native("playerState"), state => state.sessionId === sessionId && state.status === "playing" && state.positionMs >= 150 && Number(state.videoWidth) > 0 && Number(state.videoHeight) > 0, "first rendered libmpv frame");
  assert.equal(frame.engine, "libmpv"); assert.equal(frame.engineInitialized, true); assert.equal(frame.mediaFileId, mediaId);
  assert.ok(frame.durationMs >= 39000 && frame.durationMs <= 41000); engine = frame.engineInstance;
  const lookups = () => result.requests.gateway.filter(request => request.method !== "PROPFIND").length;
  assert.equal(lookups(), 1, "probe and first video read must share the signed redirect");
  await control("pause");
  result.cases.firstFrame = { elapsedMs: Date.now() - started, durationMs: frame.durationMs, videoWidth: frame.videoWidth, videoHeight: frame.videoHeight, gatewayResolutions: lookups(), engineInstance: engine };
  screenshot("first-frame");
  result.cases.seek = await seek(28000, "uncached forward seek");
  assert.equal(lookups(), 1, "seek must not resolve the gateway again");
  ticket = 2;
  result.cases.expiredSignatureRecovery = await seek(16000, "expired signature seek");
  assert.equal(lookups(), 2, "expired signature must refresh exactly once through WebDAV");
  assert.ok(result.requests.cdn.some(request => request.ticket === 1 && request.status === 403));
  assert.ok(result.requests.cdn.some(request => request.ticket === 2 && request.status === 206));
  assert.ok(result.requests.cdn.every(request => !request.authorizationPresent && !request.cookiePresent));
  assert.ok(result.requests.gateway.every(request => request.authorized));
  result.cases.expiredSignatureRecovery.gatewayResolutions = lookups();
  screenshot("recovered-frame"); result.passed = true;
} catch (error) { failure = error; result.error = String(error); if (guarded) try { screenshot("failure"); } catch {} }
finally {
  try { await cleanup(); } catch (error) { result.cleanupError = String(error); result.passed = false; failure ||= error; }
  await browser?.close().catch(() => {});
  if (forwardOwned) try { command("forward", "--remove", `tcp:${cdpPort}`); } catch {}
  for (const port of reversedPorts) try { command("reverse", "--remove", `tcp:${port}`); } catch {}
  for (const server of [gateway, cdn].filter(Boolean)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed === true, output, cases: result.cases, cleanup: result.cleanup, error: result.error, cleanupError: result.cleanupError }));
}
if (failure) throw failure;
