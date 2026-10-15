import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const app="com.genzo.android.organizeqa", adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial="3B164M00Z0500000";
const output=`D:/DevTools/Android/Build/qa/player-theme-20261015/device-${Date.now()}`;mkdirSync(output,{recursive:true});
const command=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:20000});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const media=readFileSync("D:/DevTools/Android/Samples/GenzoPrototype/h264.mp4");
const server=createServer((req,res)=>{
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||"");
  const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
  if(start>end){res.writeHead(416);res.end();return;}
  res.writeHead(range?206:200,{"Content-Type":"video/mp4","Content-Length":end-start+1,"Accept-Ranges":"bytes",...(range?{"Content-Range":`bytes ${start}-${end}/${media.length}`}:{})});
  res.end(media.subarray(start,end+1));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const port=server.address().port;
let browser,page,invoke,session,originalTheme,originalPreferences,originalPlayback,guarded=false;
const result={app,cases:{}};
function foreground(){assert.ok(command("shell","dumpsys","activity","activities").split("\n").find(line=>line.includes("topResumedActivity"))?.includes(app),"QA app must remain foreground");}
function dump(){foreground();try{command("shell","uiautomator","dump","/data/local/tmp/genzo-theme.xml");}catch(error){if(!String(error.stdout).includes("UI hierchary dumped to:"))throw error;}return command("shell","cat","/data/local/tmp/genzo-theme.xml");}
function tap(label){const node=[...dump().matchAll(/<node\b[^>]*>/g)].find(match=>match[0].includes(`content-desc="${label}"`)||match[0].includes(`text="${label}"`));assert.ok(node,label);const b=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node[0]).slice(1).map(Number);foreground();command("shell","input","tap",String((b[0]+b[2])>>1),String((b[1]+b[3])>>1));}
function shot(name){foreground();writeFileSync(`${output}/${name}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{timeout:20000,maxBuffer:16000000}));}
async function wait(read,accept,label){let value;for(let i=0;i<100;i++){value=await read();if(accept(value))return value;await delay(100);}throw new Error(label);}
const native=(command,payload={})=>invoke("android_native",{command,payload});
async function appearance(){
  const xml=command("shell","run-as",app,"cat","shared_prefs/genzo-appearance.xml");
  return page.evaluate(xml=>{
    const document=new DOMParser().parseFromString(xml,"application/xml");
    const values=Object.fromEntries([...document.querySelectorAll("string")].map(node=>[node.getAttribute("name"),node.textContent]));
    return {appearance:{mode:values.mode,light:JSON.parse(values.light),dark:JSON.parse(values.dark)}};
  },xml);
}
async function theme(mode){
  const select=page.getByLabel("主题模式",{exact:true});
  await select.selectOption(mode);return wait(appearance,value=>value.appearance.mode===mode,`theme ${mode}`);
}
try {
  command("reverse",`tcp:${port}`,`tcp:${port}`);command("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await delay(800);
  const pid=command("shell","pidof",app).trim();command("forward","tcp:9349",`localabstract:webview_devtools_remote_${pid}`);
  browser=await chromium.connectOverCDP("http://127.0.0.1:9349",{noDefaults:true});page=browser.contexts()[0].pages().find(page=>page.url().includes("tauri.localhost"));assert.ok(page);
  invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);guarded=true;
  originalTheme=await invoke("get_setting",{key:"theme"});originalPreferences=await page.evaluate(()=>localStorage.getItem("genzo-preferences"));originalPlayback=await invoke("get_android_playback_preferences");
  await invoke("set_android_playback_preferences",{settings:{hardwareDecoding:true,hardwareDecoder:"mediacodec-copy",videoRenderer:"gpu",superResolution:0}});
  await page.evaluate(()=>{location.hash="#/appearance";});
  await page.getByLabel("主题模式",{exact:true}).waitFor();const light=await theme("light");
  session=crypto.randomUUID();await native("openPlayer",{uri:`http://127.0.0.1:${port}/video.mp4`,sessionId:session,sourceKind:"webdav"});
  let state=await wait(()=>native("playerState"),s=>s.sessionId===session&&s.status==="playing"&&s.durationMs>0,"real video playback");
  const engine=state.engineInstance;await native("playerControl",{action:"pause",sessionId:session});
  tap("更多播放设置");shot("light-menu");foreground();command("shell","input","keyevent","KEYCODE_BACK");
  result.cases.light={background:light.appearance.light.background,menu:light.appearance.light.menu,accent:light.appearance.light.accent};
  await theme("dark");await delay(250);assert.equal((await native("playerState")).engineInstance,engine);tap("更多播放设置");shot("dark-menu");foreground();command("shell","input","keyevent","KEYCODE_BACK");
  const old=(await appearance()).appearance.dark.accent;
  await page.evaluate(()=>document.querySelector('[aria-label="主题色 #ef4b7c"]').click());
  const custom=await wait(appearance,value=>value.appearance.dark.accent!==old,"custom accent applied");
  assert.equal((await native("playerState")).engineInstance,engine);result.cases.customAccent=custom.appearance.dark.accent;
  await page.evaluate(()=>{const toggle=[...document.querySelectorAll('[role="switch"]')].find(node=>node.textContent.includes("AMOLED"));if(toggle.getAttribute("aria-checked")!=="true")toggle.click();});
  await wait(appearance,value=>value.appearance.dark.background==="#000000","AMOLED applied");
  await native("playerControl",{action:"landscape",sessionId:session});await delay(500);tap("更多播放设置");shot("amoled-landscape-menu");foreground();command("shell","input","keyevent","KEYCODE_BACK");
  state=await native("playerState");assert.equal(state.engineInstance,engine);assert.equal(state.sessionId,session);assert.equal(state.status,"paused");
  result.cases.liveThemeAndRotationKeepEngineSessionAndPause=true;result.cases.amoledBlack=true;result.passed=true;
} finally {
  if(guarded){
    if(session)await native("playerControl",{action:"close",sessionId:session}).catch(()=>{});
    if(originalPlayback)await invoke("set_android_playback_preferences",{settings:originalPlayback});
    await invoke("set_setting",{key:"theme",value:originalTheme||"system"});
    await page.evaluate(value=>{if(value===null)localStorage.removeItem("genzo-preferences");else localStorage.setItem("genzo-preferences",value);},originalPreferences);
    await page.reload();await page.waitForSelector(".android-app");
  }
  await browser?.close();command("forward","--remove","tcp:9349");command("reverse","--remove",`tcp:${port}`);command("shell","rm","-f","/data/local/tmp/genzo-theme.xml");server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({output,...result}));
}
