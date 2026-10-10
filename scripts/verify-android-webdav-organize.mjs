import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const output = `D:/DevTools/Android/Build/qa/webdav-organize-${Date.now()}`; mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]));
const directories = {
  "/dav/": ["动漫/"], "/dav/动漫/": ["2024/"],
  "/dav/动漫/2024/": ["葬送的芙莉莲/", "迷宫饭/", "不存在的整理测试作品QA/"],
  "/dav/动漫/2024/葬送的芙莉莲/": ["第一季/"],
  "/dav/动漫/2024/葬送的芙莉莲/第一季/": ["01.mkv", "02.mkv", "01.ass"],
  "/dav/动漫/2024/迷宫饭/": ["01.mkv"],
  "/dav/动漫/2024/不存在的整理测试作品QA/": ["01.mkv"],
};
const requests = [];
const escape = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  requests.push({ method: request.method, path });
  if (request.method !== "PROPFIND" || !directories[path]) { response.writeHead(404); response.end(); return; }
  const entries = ["", ...directories[path]].map(name => {
    const directory = !name || name.endsWith("/");
    return `<d:response><d:href>${escape(encodeURI(path + name))}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype>${directory ? "" : "<d:getcontentlength>128</d:getcontentlength>"}<d:getlastmodified>Fri, 09 Oct 2026 00:00:00 GMT</d:getlastmodified><d:getetag>qa-v1</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  });
  setTimeout(() => { response.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" }); response.end(`<d:multistatus xmlns:d="DAV:">${entries.join("")}</d:multistatus>`); }, 150);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port;
command("reverse", `tcp:${port}`, `tcp:${port}`);
const pid = command("shell", "pidof", app).trim(); command("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost")); page.setDefaultTimeout(25000);
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector(".android-app"));
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { serial, app, output, cases: {} };
try {
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`);
  assert.equal(await page.evaluate(() => !!window.__GENZO_FRONTEND_PREVIEW__), false, "validate bundled assets without a preview injector");
  const root = await invoke("add_webdav_source", { input: { name: "目录整理验收", endpoint: `http://127.0.0.1:${port}`, directory: "/dav/", username: "qa", password: "qa", kind: "video" } });
  result.sourceId = root;
  const { taskId } = await invoke("scan_video_source", { sourceId: root });
  await assert.rejects(() => invoke("remove_webdav_source", { id: root }), /扫描/); result.cases.activeScanProtected = true;
  for (let index = 0; index < 200; index++) {
    const task = (await invoke("list_scan_tasks")).find(task => task.id === taskId);
    if (task?.stage === "completed") break;
    assert.ok(!["failed", "cancelled", "interrupted"].includes(task?.stage), JSON.stringify(task));
    if (index === 199) throw new Error("scan timed out"); await delay(100);
  }
  const groups = (await invoke("list_unassigned_media_groups")).filter(group => group.representative.libraryRootId === root);
  assert.equal(groups.length, 3); assert.ok(groups.some(group => group.title === "葬送的芙莉莲" && group.fileCount === 3));
  for (const group of groups) {
    const scope = await invoke("list_recognition_group_members", { mediaFileId: group.representative.id, groupScope: "season" });
    assert.equal(scope.title, group.title); assert.equal(scope.members.length, group.fileCount);
  }
  result.cases.nativeRootGroupingAndScope = true; console.log("Native WebDAV scan and directory scopes passed");
  await page.evaluate(() => location.hash = "#/inbox");
  await page.getByRole("button", { name: /目录整理验收/ }).click();
  await page.getByRole("button", { name: /动漫.*3 组/ }).click(); await page.getByRole("button", { name: /2024.*3 组/ }).click(); shot("directory");
  await page.getByRole("button", { name: "逐个整理此目录", exact: true }).click();
  const query = page.getByLabel("搜索作品资料"); const first = await query.inputValue();
  await page.getByRole("button", { name: "跳过，整理下一项", exact: true }).click(); assert.notEqual(await query.inputValue(), first);
  await page.getByRole("button", { name: "关闭", exact: true }).click(); result.cases.realManualQueue = true;
  await page.getByRole("button", { name: /自动识别此目录/ }).click();
  for (let index = 0; index < 600; index++) {
    const text = await page.locator('p[role="status"]').innerText().catch(() => "");
    if (text.includes("已处理 3/3")) { result.summary = text; break; }
    if (index % 40 === 0) console.log(text || "Waiting for real Bangumi recognition");
    if (index === 599) throw new Error("recognition timed out"); await delay(300);
  }
  const works = await invoke("list_works");
  const mapped = [];
  for (const work of works) {
    const detail = await invoke("get_work", { id: work.id });
    if (!detail.mediaFiles.some(file => file.libraryRootId === root)) continue;
    const structure = await invoke("get_anime_work_structure", { workId: work.id });
    mapped.push({ id: work.id, title: work.title, bangumiId: structure.bangumiId, episodes: structure.episodes.length, linked: structure.episodes.flatMap(episode => episode.localFiles).filter(file => file.libraryRootId === root).length });
  }
  result.mapped = mapped;
  assert.ok(mapped.some(work => work.title.includes("芙莉莲") && work.linked === 2 && work.episodes > 0), JSON.stringify(mapped));
  assert.ok((await invoke("list_unassigned_media_groups")).some(group => group.representative.libraryRootId === root && group.title.includes("不存在")), "unknown work remains unassigned");
  result.cases.realBangumiAutomaticAndOfficialLinks = true; shot("automatic-result");
  await page.evaluate(id => location.hash = `#/detail/${id}`, mapped.find(work => work.title.includes("芙莉莲")).id);
  await page.getByRole("tab", { name: "剧集", exact: true }).click();
  await page.getByRole("button", { name: "本地", exact: true }).click();
  await page.getByText("此来源暂未关联视频，可切换其他来源或在待整理中关联文件。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "WebDAV", exact: true }).click();
  await page.getByRole("button", { name: /^播放 第 1 集/ }).waitFor();
  shot("official-episode-sources"); result.cases.realEpisodeSourceFilter = true;
  const before = works.map(({ id, status, favorite, rating }) => ({ id, status, favorite, rating })).sort((a,b) => a.id.localeCompare(b.id));
  await page.evaluate(() => location.hash = "#/sources");
  const source = page.locator(".gz-source").filter({ hasText: "目录整理验收" });
  await source.getByRole("button", { name: "移除连接", exact: true }).click();
  await page.getByRole("button", { name: "确认移除连接", exact: true }).click(); await source.waitFor({ state: "detached" });
  assert.ok(!(await invoke("get_video_source_states")).some(source => source.id === root));
  assert.ok(!(await invoke("list_unassigned_media_groups")).some(group => group.representative.libraryRootId === root));
  const after = (await invoke("list_works")).map(({ id, status, favorite, rating }) => ({ id, status, favorite, rating })).sort((a,b) => a.id.localeCompare(b.id));
  assert.deepEqual(after, before); result.cases.connectionRemovalPreservesWorks = true;
  assert.ok(requests.every(request => request.method === "PROPFIND"), "no video reads or remote deletes");
  result.methods = [...new Set(requests.map(request => request.method))]; shot("removed");
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ output, passed: true, summary: result.summary, mapped }));
} catch (error) { result.error = String(error); shot("failure"); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error; }
finally { await browser.close(); command("reverse", "--remove", `tcp:${port}`); command("forward", "--remove", "tcp:9346"); server.close(); }
