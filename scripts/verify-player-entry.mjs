import assert from "node:assert/strict";
import {build} from "vite";
import {chromium} from "playwright-core";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
const output="D:/DevTools/Android/Build/qa/player-entry-20261013/browser";
mkdirSync(output,{recursive:true});
await build({configFile:false,logLevel:"error",define:{"process.env.NODE_ENV":'"production"',__GENZO_ANDROID__:"true"},esbuild:{jsx:"automatic"},build:{outDir:output+"/fixture",lib:{entry:"scripts/fixtures/player-entry.tsx",name:"EntryFixture",formats:["iife"],fileName:()=>"fixture.js",cssFileName:"fixture"}}});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
page.on("pageerror",error=>errors.push(String(error)));
try{
 await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
 await page.addStyleTag({content:readFileSync(output+"/fixture/fixture.css","utf8")});await page.addScriptTag({content:readFileSync(output+"/fixture/fixture.js","utf8")});
 const entry=page.locator(".gz-continue");await entry.waitFor();await entry.click();await entry.click();
 assert.deepEqual(await page.evaluate(()=>window.__qaCalls),["file"]);assert.equal(await page.locator(".gz-busy").count(),0);
 await page.screenshot({path:output+"/pending.png"});
 await page.evaluate(()=>window.__qaFinish());await page.waitForTimeout(30);await entry.click();
 assert.deepEqual(await page.evaluate(()=>window.__qaCalls),["file","file"]);assert.equal(await page.locator(".gz-busy").count(),0);
 await page.evaluate(()=>window.__qaFinish(true));await page.getByText("Error: 隔离连接失败",{exact:true}).waitFor();
 assert.equal(await page.locator(".gz-busy").count(),0);assert.deepEqual(errors,[]);
 const layouts=[];for(const width of [360,412,915,1024,1366,1920]){await page.setViewportSize({width,height:915});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);layouts.push(width);}
 const result={cases:["no outer spinner while opening","duplicate clicks share one open","opening state unlocks entry","errors are visible without busy overlay"],layouts,errors};writeFileSync(output+"/result.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
