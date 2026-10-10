import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Only our isolated test package and loopback DAV fixture. Never seed user data.
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const output = `D:/DevTools/Android/Build/qa/background-import-${Date.now()}`; mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const directories = {
  "/dav/": ["动漫/", "电影/"], "/dav/动漫/": ["2024/"], "/dav/电影/": ["真人测试作品/"], "/dav/电影/真人测试作品/": ["01.mkv"],
  "/dav/动漫/2024/": ["葬送的芙莉莲/", "迷宫饭/", "不存在的整理测试作品QA/"],
  "/dav/动漫/2024/葬送的芙莉莲/": ["第一季/"], "/dav/动漫/2024/葬送的芙莉莲/第一季/": ["01.mkv", "02.mkv", "01.ass"],
  "/dav/动漫/2024/迷宫饭/": ["01.mkv"], "/dav/动漫/2024/不存在的整理测试作品QA/": ["01.mkv"],
};
const requests = []; let slow = 900;
const escape = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname); requests.push({ method: request.method, path, at: Date.now() });
  if (request.method !== "PROPFIND" || !directories[path]) { response.writeHead(404); response.end(); return; }
  const entries = ["", ...directories[path]].map(name => {
    const directory = !name || name.endsWith("/");
    return `<d:response><d:href>${escape(encodeURI(path + name))}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype>${directory ? "" : "<d:getcontentlength>128</d:getcontentlength>"}<d:getlastmodified>Fri, 09 Oct 2026 00:00:00 GMT</d:getlastmodified><d:getetag>qa-v1</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  });
  setTimeout(() => { response.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" }); response.end(`<d:multistatus xmlns:d="DAV:">${entries.join("")}</d:multistatus>`); }, slow);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port;
command("reverse", `tcp:${port}`, `tcp:${port}`);
let browser, page;
async function connect() {
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); command("shell", "wm", "dismiss-keyguard");
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1000);
  const pid = command("shell", "pidof", app).trim(); command("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true, timeout: 8000 });
  page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost")); page.setDefaultTimeout(20000);
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector(".android-app"));
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`);
  assert.equal(await page.evaluate(() => !!window.__GENZO_FRONTEND_PREVIEW__), false);
}
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const tasks = () => invoke("list_source_imports");
const result = { serial, app, output, cases: {} }; let root;
async function finished(id) {
  for (let i = 0; i < 360; i++) {
    const task = (await tasks()).find(task => task.id === id);
    if (task?.stage === "completed") return task;
    assert.ok(!["failed", "cancelled", "interrupted"].includes(task?.stage), JSON.stringify(task));
    if (i % 30 === 0) console.log(JSON.stringify({ stage: task?.stage, done: task?.done, total: task?.total }));
    await delay(500);
  } throw new Error("background import timed out");
}
try {
  await connect();
  const token = `eyJ${"x".repeat(2045)}`;
  await invoke("set_setting", { key: "metadata.tmdb_read_token", value: `Bearer ${token}` });
  assert.ok((await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb")?.configured);
  assert.equal(await invoke("get_setting", { key: "metadata.tmdb_read_token" }), null);
  const cipher = command("shell", "run-as", app, "cat", `shared_prefs/genzo-encrypted-credentials.xml`);
  assert.ok(!cipher.includes(token));
  await browser.close(); command("shell", "am", "force-stop", app); await connect();
  assert.ok((await invoke("get_metadata_provider_statuses")).find(item => item.key === "tmdb")?.configured); result.cases.longTokenEncryptedAndSurvivesRestart = true;
  await page.evaluate(() => location.hash = "#/sources");
  const input = page.getByLabel("TMDB API Read Access Token"); await input.fill(token);
  assert.equal((await input.inputValue()).length, 2048);
  await page.getByRole("button", { name: "保存 Token", exact: true }).click(); await page.getByText("TMDB 配置已保存", { exact: true }).waitFor();
  shot("long-token-saved"); await page.getByRole("button", { name: "清除 Token", exact: true }).click(); await page.getByText("TMDB 配置已清除", { exact: true }).waitFor();
  result.cases.longTokenUI = true;
  root = await invoke("add_webdav_source", { input: { name: "后台整理验收", endpoint: `http://127.0.0.1:${port}`, directory: "/dav/", username: "qa", password: "qa", kind: "video" } }); result.sourceId = root;
  const first = (await tasks()).find(task => task.sourceIds.includes(root)); assert.ok(first, "first import starts automatically"); result.firstTaskId = first.id;
  await assert.rejects(() => invoke("remove_webdav_source", { id: root }), /后台整理/);
  await page.evaluate(() => location.hash = "#/library");
  command("shell", "input", "keyevent", "KEYCODE_HOME"); const before = requests.length;
  const service = command("shell", "dumpsys", "activity", "services", app); assert.match(service, /SourceImportService/); assert.match(service, /isForeground=true/);
  await delay(4500); assert.ok(requests.length > before, "DAV requests continue while UI is backgrounded"); result.cases.nativeForegroundServiceAndHomeContinuation = true;
  command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(700);
  await page.getByRole("button", { name: "查看后台整理任务", exact: true }).click(); shot("background-task-directory");
  command("shell", "input", "keyevent", "KEYCODE_BACK");
  await page.locator("dialog[data-source-import-dialog]").waitFor({ state: "hidden" }); result.cases.hardwareBackClosesTaskDialog = true;
  result.first = await finished(first.id);
  assert.equal(result.first.total, 3); assert.equal(result.first.matched, 2); assert.equal(result.first.pending, 1);
  result.cases.firstScanAndReliableRecognition = true;
  const remaining = (await invoke("list_unassigned_media_groups")).filter(group => group.representative.libraryRootId === root);
  assert.ok(remaining.some(group => group.title.includes("不存在"))); assert.ok(remaining.some(group => group.folderPath.includes("电影")));
  result.cases.unknownAndLiveActionRemainManual = true;
  await page.evaluate(() => location.hash = "#/inbox"); await page.getByRole("button", { name: /后台整理验收/ }).click();
  await page.getByRole("button", { name: /动漫.*1 组/ }).click(); await page.getByRole("button", { name: /2024.*1 组/ }).click();
  await page.getByRole("button", { name: "逐个整理此目录", exact: true }).click();
  await page.getByText(/当前识别文件夹/).waitFor(); assert.match(await page.locator(".gz-sheet").innerText(), /动漫\/2024\/不存在/);
  shot("manual-current-folder"); await page.getByRole("button", { name: "关闭", exact: true }).click(); result.cases.manualFolderIsVisible = true;
  directories["/dav/动漫/2024/迷宫饭/"].push("02.mkv"); const idleCount = requests.length; await delay(3000); assert.equal(requests.length, idleCount, "new files are not silently rescanned");
  result.cases.laterFilesRequireManualRefresh = true;
  slow = 100;
  const manual = await invoke("start_source_import", { sourceIds: [root], scan: true }); result.manual = await finished(manual.id);
  const mapped = [];
  for (const work of await invoke("list_works")) {
    const detail = await invoke("get_work", { id: work.id }); if (!detail.mediaFiles.some(file => file.libraryRootId === root)) continue;
    const structure = await invoke("get_anime_work_structure", { workId: work.id });
    mapped.push({ id: work.id, title: work.title, episodes: structure.episodes.length, linked: structure.episodes.flatMap(episode => episode.localFiles).filter(file => file.libraryRootId === root).length });
  }
  assert.ok(mapped.some(work => work.title.includes("迷宫饭") && work.linked === 2)); result.mapped = mapped; result.cases.manualUpdateIndexesNewEpisode = true;
  await page.evaluate(id => location.hash = `#/detail/${id}`, mapped.find(work => work.title.includes("芙莉莲")).id);
  await page.getByRole("tab", { name: "剧集", exact: true }).click();
  await page.getByRole("button", { name: "本地", exact: true }).click();
  await page.getByText("此来源暂未关联视频，可切换其他来源或在待整理中关联文件。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "WebDAV", exact: true }).click(); await page.getByRole("button", { name: /^播放 第 1 集/ }).waitFor();
  shot("official-episode-sources"); result.cases.officialEpisodeSourceFilter = true;
  // Interrupt only this QA app, then explicitly resume its persisted scan.
  slow = 900; const restart = await invoke("start_source_import", { sourceIds: [root], scan: true }); await delay(700);
  await browser.close(); command("shell", "am", "force-stop", app); await connect();
  assert.equal((await tasks()).find(task => task.id === restart.id)?.stage, "interrupted");
  const requestsBefore = requests.length; await delay(1500); assert.equal(requests.length, requestsBefore, "restart does not rescan silently");
  slow = 100; await invoke("resume_source_import", { id: restart.id }); await finished(restart.id); result.cases.interruptionAndExplicitResume = true;
  const cancelled = await invoke("start_source_import", { sourceIds: [root], scan: true }); await invoke("cancel_source_import", { id: cancelled.id });
  for (let i = 0; i < 50; i++) { if ((await tasks()).find(task => task.id === cancelled.id)?.stage === "cancelled") break; await delay(100); }
  assert.equal((await tasks()).find(task => task.id === cancelled.id)?.stage, "cancelled"); result.cases.cooperativeCancel = true;
  await invoke("remove_webdav_source", { id: root }); result.cases.removalAfterTaskPreservesFiles = true;
  assert.ok(requests.every(request => request.method === "PROPFIND")); result.methods = [...new Set(requests.map(request => request.method))];
  const servicesAfter = command("shell", "dumpsys", "activity", "services", app); assert.ok(!servicesAfter.includes("isForeground=true")); result.cases.serviceStopsWhenIdle = true;
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ output, passed: true, cases: result.cases }));
} catch (error) { result.error = String(error); shot("failure"); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error; }
finally { await browser?.close(); command("reverse", "--remove", `tcp:${port}`); command("forward", "--remove", "tcp:9346"); server.close(); }
