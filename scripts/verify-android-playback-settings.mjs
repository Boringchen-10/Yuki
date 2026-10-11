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
  await control("close"); await until(s => s.status === "closed", "closed before global settings"); await delay(500);
  const original = await invoke("get_android_playback_preferences");
  await assert.rejects(() => invoke("set_android_playback_preferences", { settings: { ...original, videoRenderer: "mediacodec_embed", superResolution: 2 } }));
  assert.deepEqual(await invoke("get_android_playback_preferences"), original); result.cases.invalidGlobalSaveIsAtomic = true;
  const global = { hardwareDecoding: false, hardwareDecoder: "auto-safe", videoRenderer: "gpu", superResolution: 1 };
  assert.deepEqual(await invoke("set_android_playback_preferences", { settings: global }), global);
  assert.deepEqual(await invoke("get_android_playback_preferences"), global); result.cases.globalSettingsSaveWithoutPlayer = true;
  await open(); const globalPlayer = await until(s => s.decoder === "no" && s.superResolution === 1 && s.gpuRenderer === "gpu", "next player uses global preferences");
  result.snapshots.globalPlayer = globalPlayer; result.cases.nextVideoAppliesGlobalSettings = true; await control("close"); await delay(700);
  await page.evaluate(() => location.hash = "#/profile"); await page.getByRole("button", { name: /^播放设置/ }).click();
  const hardware = page.getByRole("switch", { name: /硬件解码/ }); await hardware.waitFor();
  assert.equal(await hardware.getAttribute("aria-checked"), "false"); await hardware.click(); await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true");
  assert.equal((await invoke("get_android_playback_preferences")).hardwareDecoding, true);
  await page.getByRole("button", { name: /硬件解码器/ }).click(); await page.getByRole("radio", { name: /^mediacodec-copy/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.startsWith("mediacodec-copy"));
  cmd("shell", "input", "keyevent", "KEYCODE_BACK"); await page.getByRole("button", { name: /视频渲染器/ }).waitFor();
  await page.getByRole("button", { name: /视频渲染器/ }).click(); await page.getByRole("radio", { name: /^Vulkan/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.startsWith("Vulkan"));
  cmd("shell", "input", "keyevent", "KEYCODE_BACK"); await page.getByRole("button", { name: /超分辨率/ }).click();
  await page.getByRole("radio", { name: /^画质档/ }).click(); await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.startsWith("画质档"));
  writeFileSync(`${output}/profile-super-settings.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  const selected = await invoke("get_android_playback_preferences"); assert.equal(selected.superResolution, 2); assert.equal(selected.videoRenderer, "gpu-next"); assert.equal(selected.hardwareDecoder, "mediacodec-copy");
  result.cases.profileSettingsUiSavesNativePreferences = true;
  cmd("shell", "input", "keyevent", "KEYCODE_BACK"); await page.getByRole("button", { name: /视频渲染器/ }).waitFor();
  await delay(400);
  writeFileSync(`${output}/profile-playback-settings.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  await open(); await until(s => s.gpuRenderer === "gpu-next" && s.superResolution === 2 && s.shaderPasses.some(p => p.includes("Anime4K")), "profile settings effective in native video");
  result.cases.profileSelectionAppliedToPlayback = true;
  await control("pause"); await until(s => s.status === "paused", "pause for player controls"); await delay(700);
  const dump = () => { cmd("shell", "uiautomator", "dump", "/data/local/tmp/genzo-player-settings.xml"); return cmd("shell", "cat", "/data/local/tmp/genzo-player-settings.xml"); };
  const tapText = (xml, text) => {
    const node = [...xml.matchAll(/<node\b[^>]*>/g)].find(match => match[0].includes(`text="${text}"`))?.[0];
    assert.ok(node, `missing native control ${text}`);
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    assert.ok(bounds); cmd("shell", "input", "tap", String((Number(bounds[1]) + Number(bounds[3])) >> 1), String((Number(bounds[2]) + Number(bounds[4])) >> 1));
  };
  const controls = dump();
  assert.ok(controls.includes('text="超分·画质"'));
  for (const text of ["倍速", "播放设置", "硬件解码", "视频渲染器"]) assert.ok(!controls.includes(`text="${text}"`));
  tapText(controls, "超分·画质"); await delay(300);
  const tiers = dump();
  for (const text of ["关闭", "流畅 · 适合日常观看", "画质 · 更清晰，耗电更高"]) assert.ok(tiers.includes(`text="${text}"`));
  writeFileSync(`${output}/player-super-tiers.png`, execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 16 * 1024 * 1024 }));
  tapText(tiers, "关闭"); await until(s => s.superResolution === 0 && s.shaderCount === 0 && s.status === "paused", "native tier selection applies");
  result.cases.playerOnlyHasSuperResolutionSettingsShortcut = true;
  await control("close"); await invoke("set_android_playback_preferences", { settings: original });
  console.log(JSON.stringify({ output, cases: result.cases }));
} catch (error) { result.error = String(error); throw error; }
finally {
  if (guarded) await control("close").catch(() => {});
  if (guarded) cmd("shell", "rm", "-f", "/data/local/tmp/genzo-player-settings.xml");
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  await browser?.close(); cmd("forward", "--remove", "tcp:9346"); cmd("reverse", "--remove", `tcp:${port}`); server.close();
}
