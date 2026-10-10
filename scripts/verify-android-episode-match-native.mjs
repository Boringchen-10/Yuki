import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// This script cannot target the user's normal/debug app or real WebDAV server.
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const output = `D:/DevTools/Android/Build/qa/episode-match-native-${Date.now()}`; mkdirSync(output, { recursive: true });
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
const shot = name => writeFileSync(`${output}/${name}.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const title = "小林家的龙女仆S";
const directories = { "/dav/": ["动漫/"], "/dav/动漫/": [`${title}/`], [`/dav/动漫/${title}/`]: ["第二季/"], [`/dav/动漫/${title}/第二季/`]: Array.from({ length: 12 }, (_, index) => `${index + 13}.mkv`) };
const requests = [];
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname); requests.push({ method: request.method, path });
  if (request.method !== "PROPFIND" || !directories[path]) { response.writeHead(404); response.end(); return; }
  const entries = ["", ...directories[path]].map(name => {
    const directory = !name || name.endsWith("/");
    return `<d:response><d:href>${encodeURI(path + name)}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype>${directory ? "" : "<d:getcontentlength>128</d:getcontentlength>"}<d:getlastmodified>Fri, 09 Oct 2026 00:00:00 GMT</d:getlastmodified><d:getetag>offset-qa-v1</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  });
  response.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" }); response.end(`<d:multistatus xmlns:d="DAV:">${entries.join("")}</d:multistatus>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; command("reverse", `tcp:${port}`, `tcp:${port}`);
command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); command("shell", "wm", "dismiss-keyguard"); command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1200);
const pid = command("shell", "pidof", app).trim(); command("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true, timeout: 8000 }); const page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost")); page.setDefaultTimeout(20000);
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const result = { app, output, cases: {} }; let root;
try {
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`); assert.equal(await page.evaluate(() => !!window.__GENZO_FRONTEND_PREVIEW__), false);
  const subject = (await invoke("search_explore_subjects", { query: title })).find(subject => subject.title === title); assert.ok(subject);
  const official = await invoke("get_bangumi_subject_structure", { externalId: subject.externalId, section: "episodes" });
  const main = official.episodes.filter(episode => !episode.episodeType); assert.deepEqual(main.map(episode => episode.episodeNumber), Array.from({ length: 12 }, (_, index) => index + 1)); result.cases.realTwelveEpisodeSecondSeason = true;
  root = await invoke("add_webdav_source", { input: { name: "续季绝对编号验收", endpoint: `http://127.0.0.1:${port}`, directory: "/dav/", username: "qa", password: "qa", kind: "video" } }); result.sourceId = root;
  for (let index = 0; index < 360; index++) {
    const task = (await invoke("list_source_imports")).find(task => task.sourceIds.includes(root));
    if (task?.stage === "completed") break;
    assert.ok(!["failed", "cancelled", "interrupted"].includes(task?.stage), JSON.stringify(task)); if (index === 359) throw new Error("scan/recognition timed out"); await delay(500);
  }
  let target;
  for (const work of await invoke("list_works")) { const detail = await invoke("get_work", { id: work.id }); if (detail.mediaFiles.some(file => file.libraryRootId === root)) { target = work.id; break; } }
  if (!target) {
    const group = (await invoke("list_unassigned_media_groups")).find(group => group.representative.libraryRootId === root); assert.ok(group);
    const choices = await invoke("recognize_media_file", { mediaFileId: group.representative.id, query: title, kind: "anime" });
    const candidate = choices.candidates.find(candidate => candidate.externalId === subject.externalId); assert.ok(candidate);
    const scope = await invoke("list_recognition_group_members", { mediaFileId: group.representative.id, groupScope: "season" });
    target = await invoke("confirm_match_candidate", { mediaFileId: candidate.mediaFileId, candidateId: candidate.id, selectedMediaIds: scope.members.map(file => file.id), groupScope: "season" });
  }
  result.workId = target;
  let before;
  for (let index = 0; index < 180; index++) { before = await invoke("get_anime_work_structure", { workId: target }); if (before.episodes.filter(episode => !episode.episodeType).length === 12) break; if (index === 179) throw new Error("official metadata timed out"); await delay(500); }
  const detailBefore = await invoke("get_work", { id: target }); const files = detailBefore.mediaFiles.filter(file => file.libraryRootId === root && file.mediaType === "video"); assert.equal(files.length, 12);
  assert.equal(before.episodes.flatMap(episode => episode.localFiles).filter(file => file.libraryRootId === root).length, 0); result.cases.originalAbsoluteNumbersRemainUnmatched = true;
  command("shell", "input", "keyevent", "KEYCODE_WAKEUP"); command("shell", "wm", "dismiss-keyguard");
  await page.evaluate(id => location.hash = `#/detail/${id}`, target); await page.getByRole("tab", { name: "剧集", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "个人记录", exact: true }).count(), 0); result.cases.personalRecordButtonRemoved = true;
  await page.getByRole("button", { name: "批量匹配剧集", exact: true }).click();
  await page.getByLabel("文件起始集号", { exact: true }).fill("13"); await page.getByLabel("对应官方起始集号", { exact: true }).fill("1"); await page.getByLabel("作品季度（可选）", { exact: true }).fill("2");
  await page.getByRole("button", { name: "预览匹配（12 个）", exact: true }).click();
  await page.locator('[aria-label="批量剧集匹配预览"]').getByText(/文件第 24 集 → 官方第 12 集/).waitFor(); shot("offset-preview");
  await page.getByRole("checkbox", { name: "已核对文件与官方分集的逐行对应", exact: true }).check(); await page.getByRole("button", { name: "确认批量匹配", exact: true }).click();
  await page.locator(".gz-scrim").waitFor({ state: "detached" });
  const after = await invoke("get_anime_work_structure", { workId: target });
  const mapping = after.episodes.filter(episode => !episode.episodeType).map(episode => ({ official: episode.episodeNumber, files: episode.localFiles.filter(file => file.libraryRootId === root).map(file => file.fileName) }));
  assert.deepEqual(mapping, Array.from({ length: 12 }, (_, index) => ({ official: index + 1, files: [`${index + 13}.mkv`] }))); result.mapping = mapping; result.cases.realNativeBatchOffsetMapping = true;
  const detailAfter = await invoke("get_work", { id: target });
  assert.deepEqual(detailAfter.mediaFiles.filter(file => file.libraryRootId === root).map(({ id, path, fileName, parsedEpisodeStart }) => ({ id, path, fileName, parsedEpisodeStart })).sort((a,b) => a.id.localeCompare(b.id)), files.map(({ id, path, fileName, parsedEpisodeStart }) => ({ id, path, fileName, parsedEpisodeStart })).sort((a,b) => a.id.localeCompare(b.id)));
  for (const key of ["status", "rating", "favorite", "notes"]) assert.equal(detailAfter[key], detailBefore[key]); result.cases.mediaIdentityAndPersonalDataPreserved = true;
  await page.locator(".gz-scroll").evaluate(node => { const section = node.querySelector(".gz-episodes"); if (section) node.scrollTop = section.offsetTop - 100; }); shot("matched-episodes");
  const workIdsBefore = (await invoke("list_works")).map(work => work.id); await invoke("remove_webdav_source", { id: root }); assert.deepEqual((await invoke("list_works")).map(work => work.id), workIdsBefore);
  assert.ok(requests.every(request => request.method === "PROPFIND")); result.cases.noMediaReadsOrRemoteDeletes = true;
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ output, passed: true, cases: result.cases }));
} catch (error) { result.error = String(error); shot("failure"); writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); throw error; }
finally { await browser.close(); command("reverse", "--remove", `tcp:${port}`); command("forward", "--remove", "tcp:9346"); server.close(); }
