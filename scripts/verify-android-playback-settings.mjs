import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const app = "com.genzo.android.organizeqa", serial = "3B164M00Z0500000", adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe";
const output = `D:/DevTools/Android/Build/qa/playback-settings-${Date.now()}`;
mkdirSync(output, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 20000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const media = readFileSync("D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4");
const server = createServer((req, res) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
  res.writeHead(match ? 206 : 200, { "Content-Type": "video/mp4", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(match ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}) });
  res.end(media.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port; cmd("reverse", `tcp:${port}`, `tcp:${port}`);
let browser, page, guarded = false, sessionId;
const result = { output, cases: {}, snapshots: {} };
const invoke = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const native = (command, payload = {}) => invoke("android_native", { command, payload });
const control = (action, extra = {}) => native("playerControl", { action, sessionId, ...extra });
async function until(accept, label) {
  let last; const end = Date.now() + 35000;
  while (Date.now() < end) { last = await native("playerState"); if (accept(last)) return last; await delay(250); }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}
async function shot(name, aspect = false) {
  const path = `${output}/${name}.png`;
  writeFileSync(path, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  const python = "from PIL import Image; import sys,json; im=Image.open(sys.argv[1]).convert('RGB'); w,h=im.size; im=im.crop((0,0,w,int(h*.82))).resize((160,160)); pts=[(i%160,i//160) for i,p in enumerate(im.get_flattened_data()) if max(p)-min(p)>80 and max(p)>100]; print(json.dumps({'fraction':len(pts)/25600,'aspect':((max(x for x,y in pts)-min(x for x,y in pts)+1)*w/160)/((max(y for x,y in pts)-min(y for x,y in pts)+1)*h*.82/160)}))";
  const image = JSON.parse(execFileSync("C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe", ["-c", python, path], { encoding: "utf8" }));
  assert.ok(image.fraction > 0.1, `${name}: no actual frame`);
  if (aspect) assert.ok(Math.abs(image.aspect - 16 / 9) < .15, `${name}: stretched direct Surface ${image.aspect}`);
}
async function change(renderer, hardware = true, decoder = "auto-safe") {
  await control("playbackSettings", { videoRenderer: renderer, hardwareDecoding: hardware, hardwareDecoder: decoder });
  const state = await until(s => ["playing", "paused"].includes(s.status) && s.playbackSettings?.videoRenderer === renderer && (renderer === "compat" ? s.engine.startsWith("LibVLC") : !!s.gpuRenderer), renderer);
  result.snapshots[`${renderer}-${hardware}-${decoder}`] = state; return state;
}
async function open() {
  sessionId = randomUUID(); await native("openPlayer", { uri: `http://127.0.0.1:${port}/video.mp4`, sessionId, resumeMs: 0 });
  await until(s => s.sessionId === sessionId && s.status === "playing" && s.positionMs > 500, "open");
}
try {
  cmd("shell", "input", "keyevent", "KEYCODE_WAKEUP"); cmd("shell", "wm", "dismiss-keyguard"); cmd("shell", "am", "start", "-n", `${app}/com.genzo.android.MainActivity`); await delay(1500);
  const pid = cmd("shell", "pidof", app).trim(); assert.match(pid, /^\d+$/);
  cmd("forward", "tcp:9346", `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9346", { noDefaults: true }); page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert.ok(page);
  assert.equal((await invoke("get_app_info")).dataDirectory, `/data/user/0/${app}`); guarded = true;
  await open(); await control("superResolution", { value: 0 });
  await change("compat"); result.cases.compatibilityRendererRetained = true;
  await control("pause"); await until(s => s.status === "paused", "paused"); await control("seek", { value: 10000 }); await control("rate", { value: 1.5 });
  const software = await change("gpu", false);
  assert.equal(software.decoder, "no"); assert.equal(software.superResolution, 0); assert.equal(software.shaderCount, 0);
  assert.equal(software.status, "paused"); assert.ok(Math.abs(software.positionMs - 10000) < 500); assert.equal(software.rate, 1.5);
  await delay(800); await shot("software-gpu"); result.cases.softwareDecodingAndStatePreserved = true;
  for (const decoder of ["auto-safe", "auto", "auto-copy", "mediacodec", "mediacodec-copy"]) {
    const state = await change("gpu", true, decoder); assert.equal(state.playbackSettings.hardwareDecoder, decoder); assert.equal(state.gpuRenderer, "gpu");
    await delay(400);
  }
  result.cases.allAndroidDecoderChoicesApply = true;
  const vk = await change("gpu-next", true, "mediacodec-copy");
  assert.equal(vk.gpuRenderer, "gpu-next", JSON.stringify(vk));
  await control("superResolution", { value: 1 });
  const vkSuper = await until(s => s.gpuRenderer === "gpu-next" && s.shaderPasses.some(p => p.includes("Anime4K")), "Vulkan Anime4K passes");
  assert.equal(vkSuper.superResolution, 1); await delay(800); await shot("vulkan-anime4k"); result.cases.vulkanRunsAnime4K = true;
  const direct = await change("mediacodec_embed", true, "mediacodec");
  assert.equal(direct.superResolution, 0); assert.equal(direct.decoder, "mediacodec"); assert.equal(direct.subtitleTrack, -1);
  await delay(1000); await shot("mediacodec-direct", true); result.cases.directRendererDisablesShadersAndPreservesAspect = true;
  await assert.rejects(() => control("playbackSettings", { videoRenderer: "mediacodec_embed", hardwareDecoding: false, hardwareDecoder: "mediacodec" }));
  await assert.rejects(() => control("playbackSettings", { videoRenderer: "gpu", hardwareDecoding: true, hardwareDecoder: "d3d11va" })); result.cases.invalidAndNonAndroidCombinationsRejected = true;
  await control("superResolution", { value: 1 });
  const promoted = await until(s => s.gpuRenderer === "gpu" && s.superResolution === 1 && s.playbackSettings.videoRenderer === "gpu", "super resolution promotes direct to GPU");
  assert.ok(promoted.shaderCount > 0); result.cases.superResolutionReplacesIncompatibleDirectRenderer = true;
  await change("auto", true, "mediacodec-copy"); await control("close"); await delay(600); await open();
  const persisted = await until(s => s.playbackSettings.videoRenderer === "auto" && s.gpuRenderer === "gpu-next", "auto persists and chooses Vulkan");
  result.snapshots.persisted = persisted; result.cases.preferencesPersistAndAutoUsesDeviceCapability = true;
  if (process.env.SETTINGS_PUBLIC === "1") {
    await invoke("control_internal_player", { sessionId, action: { type: "playback-settings", hardwareDecoding: false, hardwareDecoder: "auto-safe", videoRenderer: "gpu" } });
    await until(s => s.decoder === "no", "public decode settings control"); result.cases.publicControl = true;
  }
  await control("superResolution", { value: 0 }); await change("compat"); await control("superResolution", { value: 1 });
  await until(s => s.status === "playing" && s.gpuRenderer === "gpu", "ready for settings UI");
  await control("pause"); await until(s => s.status === "paused", "pause for accessibility UI inspection"); await delay(1100);
  cmd("shell", "uiautomator", "dump", "/data/local/tmp/GenzoPlaybackSettingsUI.xml");
  const xml = cmd("shell", "cat", "/data/local/tmp/GenzoPlaybackSettingsUI.xml");
  const button = /<node[^>]*text="播放设置"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml); assert.ok(button);
  cmd("shell", "input", "tap", String(Math.round((Number(button[1]) + Number(button[3])) / 2)), String(Math.round((Number(button[2]) + Number(button[4])) / 2))); await delay(500);
  cmd("shell", "uiautomator", "dump", "/data/local/tmp/GenzoPlaybackSettingsUI.xml");
  const settingsUi = cmd("shell", "cat", "/data/local/tmp/GenzoPlaybackSettingsUI.xml"); assert.match(settingsUi, /硬件解码器/); assert.match(settingsUi, /视频渲染器/); assert.match(settingsUi, /倍速/);
  writeFileSync(`${output}/playback-settings-ui.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  cmd("shell", "input", "keyevent", "KEYCODE_BACK"); result.cases.nativeSettingsUi = true;
  console.log(JSON.stringify({ output, cases: result.cases }));
} catch (error) { result.error = String(error); throw error; }
finally {
  if (guarded) await control("close").catch(() => {});
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser?.close(); cmd("forward", "--remove", "tcp:9346"); cmd("reverse", "--remove", `tcp:${port}`); server.close();
  cmd("shell", "rm", "-f", "/data/local/tmp/GenzoPlaybackSettingsUI.xml");
}
