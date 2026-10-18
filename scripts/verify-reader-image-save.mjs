import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";

// Saves the page shown by the comic image overlay and checks the gallery copy.
// Requires the isolated reader QA package and its synthetic book:
//   GENZO_READER_FIXTURES=<fresh dir> cargo test --lib export_native_reader_fixtures
// then copy reading-cache/v1/<comic hash> into the package data directory.
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const serial = process.env.YUKI_QA_SERIAL || "emulator-5554";
const app = "com.genzo.android.readerqa";
const book = process.env.YUKI_QA_BOOK || "reader-fixture-comic";
const gallery = "/sdcard/Pictures/Yuki";
const output = `D:/DevTools/Android/Build/qa/reader-image-save/${Date.now()}`;
mkdirSync(output, {recursive: true});
const command = (...args) => execFileSync(adb, ["-s", serial, ...args], {encoding: "utf8"});
const raw = (...args) => execFileSync(adb, ["-s", serial, ...args]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const listGallery = () => {
  try {
    return command("shell", "ls", gallery).split("\n").map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
};
function screenshot(name) { writeFileSync(`${output}/${name}.png`, raw("exec-out", "screencap", "-p")); }
function ui() {
  command("shell", "uiautomator", "dump", "/data/local/tmp/yuki-save.xml");
  return command("shell", "cat", "/data/local/tmp/yuki-save.xml");
}
function tapText(text) {
  const nodes = (ui().match(/<node\b[^>]*>/g) || []).filter(node => node.includes(`text="${text}"`));
  assert.ok(nodes.length, `Missing native control: ${text}`);
  const bounds = nodes[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(bounds, `Missing bounds for: ${text}`);
  command("shell", "input", "tap", String(((+bounds[1] + +bounds[3]) / 2) | 0), String(((+bounds[2] + +bounds[4]) / 2) | 0));
}

let native;
async function until(predicate, label, attempts = 150) {
  for (let index = 0; index < attempts; index++) {
    const state = await native("readerState");
    if (predicate(state)) return state;
    assert.notEqual(state.status, "error", JSON.stringify(state));
    await delay(100);
  }
  throw new Error(label);
}

try { command("shell", "am", "force-stop", app); } catch { /* already stopped */ }
command("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`);
await delay(1200);
const pid = command("shell", "pidof", app).trim();
assert.match(pid, /^\d+$/, "QA package did not start");
command("forward", "tcp:9277", `localabstract:webview_devtools_remote_${pid}`);
for (let attempt = 0; attempt < 40; attempt++) {
  if (command("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) break;
  await delay(250);
}
const browser = await chromium.connectOverCDP("http://127.0.0.1:9277", {noDefaults: true});
const result = {serial, output, pid, cases: {}};
try {
  const page = browser.contexts()[0].pages().find(candidate => candidate.url().includes("tauri.localhost"));
  assert.ok(page, "TAURI webview page missing");
  const invoke = (name, args = {}) => page.evaluate(({name, args}) => window.__TAURI_INTERNALS__.invoke(name, args), {name, args});
  native = (name, payload = {}) => invoke("android_native", {command: name, payload});
  assert.ok((await invoke("get_app_info")).dataDirectory.endsWith(`/${app}`), "QA data directory mismatch");
  const control = async (action, value = 0, settings) => native("readerControl", {sessionId: (await native("readerState")).sessionId, action, value, settings: settings ? JSON.stringify(settings) : null});

  await invoke("open_internal_reader", {kind: "comic", pathWord: book, entryId: "one", group: "default"});
  const ready = await until(state => state.status === "ready" && state.rendered, "reader did not render");
  result.cases.open = {entryId: ready.entryId, title: ready.title, pageIndex: ready.location?.pageIndex};
  await delay(500);
  screenshot("reader");

  const size = command("shell", "wm", "size").match(/(\d+)x(\d+)/);
  assert.ok(size, "unknown screen size");
  const x = Math.round(+size[1] / 2);
  const y = Math.round(+size[2] * 0.45);
  command("shell", "input", "tap", String(x), String(y));
  await delay(90);
  command("shell", "input", "tap", String(x), String(y));

  let panel = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(400);
    panel = ui();
    if (panel.includes('text="保存"')) break;
  }
  assert.ok(panel.includes('text="保存"'), "double tap did not open the image overlay with a save button");
  assert.ok(panel.includes('text="旋转"') && panel.includes('text="重置"') && panel.includes('text="返回"'), "existing overlay controls changed");
  screenshot("viewer");

  const before = listGallery();
  tapText("保存");
  let saved = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(300);
    const added = listGallery().filter(name => !before.includes(name));
    if (added.length) { saved = added[0]; break; }
  }
  assert.ok(saved, "no gallery file appeared after saving");
  assert.match(saved, /^Yuki .+第1页\.png$/, `unexpected gallery name: ${saved}`);
  const bytes = raw("exec-out", "cat", `${gallery}/${saved}`);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], "saved page is not the original PNG");
  writeFileSync(`${output}/${saved}`, bytes);
  result.cases.save = {name: saved, bytes: bytes.length};
  screenshot("saved");

  command("shell", "input", "keyevent", "4");
  await delay(400);
  await control("close");
  await until(state => state.status === "closed", "reader did not close");
  result.passed = true;
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({output, saved, passed: true}));
} catch (error) {
  result.error = String(error);
  result.state = await native("readerState").catch(() => null);
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  throw error;
} finally {
  await browser.close();
}
