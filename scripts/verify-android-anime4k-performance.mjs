import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
const adb = "D:/DevTools/Android/Sdk/platform-tools/adb.exe", serial = "3B164M00Z0500000", app = "com.genzo.android.organizeqa";
const out = `D:/DevTools/Android/Build/qa/anime4k-performance-20261012/${process.env.PERF_LABEL || "probe"}-${Date.now()}`;
mkdirSync(out, { recursive: true });
const cmd = (...args) => execFileSync(adb, ["-s", serial, ...args], {encoding:"utf8",timeout:20000});
const delay = ms => new Promise(r=>setTimeout(r,ms));
const media = readFileSync(process.env.PERF_SAMPLE || "D:/DevTools/Android/Build/qa/anime4k-performance-20261012/1080p24.mp4");
let requests=0;
const server=createServer((req,res)=>{
 requests++;
 const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
 const start=m?Number(m[1]):0, end=m?.[2]?Math.min(Number(m[2]),media.length-1):media.length-1;
 if(start>end){res.writeHead(416);res.end();return;}
 res.writeHead(m?206:200,{"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":end-start+1,...(m?{"Content-Range":`bytes ${start}-${end}/${media.length}`}:{})});
 res.end(req.method==="HEAD"?undefined:media.subarray(start,end+1));
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const port=server.address().port;cmd("reverse",`tcp:${port}`,`tcp:${port}`);
let browser,page,guarded=false,original;
const result={profiles:[],switches:[],out};
const invoke=(name,args={})=>page.evaluate(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const native=(command,payload={})=>invoke("android_native",{command,payload});
async function until(test,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const s=await native("playerState");if(test(s))return s;await delay(200);}throw Error(label);}
function safe(s){return Object.fromEntries(["status","positionMs","superResolution","shaderCount","gpuRenderer","decoder","droppedFrames","videoWidth","videoHeight","gpuTimeMs","engineInstance","videoFps","displayWidth","displayHeight","superResolutionFallback","effectiveSuperResolution","superResolutionPerformance"].filter(k=>k in s).map(k=>[k,s[k]]));}
try {
 cmd("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await delay(1000);
 const pid=cmd("shell","pidof",app).trim();assert.match(pid,/^\d+$/);
 cmd("forward","tcp:9346",`localabstract:webview_devtools_remote_${pid}`);
 browser=await chromium.connectOverCDP("http://127.0.0.1:9346",{noDefaults:true,timeout:8000});
 page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));assert.ok(page);
 assert.equal((await invoke("get_app_info")).dataDirectory,`/data/user/0/${app}`);guarded=true;
 original=await invoke("get_android_playback_preferences");
 const profiles=JSON.parse(process.env.PERF_PROFILES || '[{"videoRenderer":"auto","hardwareDecoder":"auto-safe","superResolution":2},{"videoRenderer":"gpu","hardwareDecoder":"mediacodec","superResolution":2}]');
 for(const profile of profiles){
  await invoke("set_android_playback_preferences",{settings:{hardwareDecoding:true,...profile}});
  const sessionId=randomUUID();await native("openPlayer",{uri:`http://127.0.0.1:${port}/sample.mp4`,sessionId,resumeMs:0});
  await until(s=>s.status==="playing"&&s.positionMs>1000,"playing");
  if(process.env.PERF_RATE) {await native("playerControl",{action:"rate",value:Number(process.env.PERF_RATE),sessionId});await delay(500);}
  const first=await native("playerState"), samples=[];
  for(let i=0;i<Number(process.env.PERF_SAMPLES || 8);i++){await delay(800);const at=performance.now();const s=await native("playerState");samples.push({...safe(s),responseMs:performance.now()-at});}
  result.profiles.push({profile,first:safe(first),samples});
  if(process.env.PERF_EXPECT_BUDGET==="1") {assert.ok(samples.at(-1).effectiveSuperResolution < profile.superResolution);assert.equal(samples.at(-1).superResolution,profile.superResolution);assert.equal((await invoke("get_android_playback_preferences")).superResolution,profile.superResolution);}
  if(profile.videoRenderer==="auto" && process.env.PERF_SWITCH !== "0"){
   for(const mode of [1,2,0,2,1]){
    const before=await native("playerState"), count=requests, at=performance.now();
    const response=await native("playerControl",{action:"superResolution",value:mode,sessionId});
    const elapsedMs=performance.now()-at;
    const after=await until(s=>s.status==="playing"&&s.superResolution===mode,"switch complete");
    result.switches.push({mode,elapsedMs,immediate:safe(response),before:safe(before),after:safe(after),newRequests:requests-count});
    if(process.env.PERF_VERIFY==="1") {assert.equal(after.engineInstance,before.engineInstance);assert.notEqual(response.status,"opening");assert.equal(requests,count);assert.ok(elapsedMs<500,"switch blocked app thread");}
    await delay(600);
   }
  }
  writeFileSync(`${out}/${profile.videoRenderer}.png`,execFileSync(adb,["-s",serial,"exec-out","screencap","-p"],{maxBuffer:16*1024*1024}));
  await native("playerControl",{action:"close"});await until(s=>s.status==="closed","closed");await delay(500);
 }
 console.log(JSON.stringify(result));
} catch(e){result.error=String(e);throw e;}
finally {
 if(guarded){await native("playerControl",{action:"close"}).catch(()=>{});if(original)await invoke("set_android_playback_preferences",{settings:original}).catch(()=>{});}
 writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 cmd("reverse","--remove",`tcp:${port}`);cmd("forward","--remove","tcp:9346");
}
