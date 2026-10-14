import assert from "node:assert/strict";
import {build} from "vite";
import {chromium} from "playwright-core";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
const output="D:/DevTools/Android/Build/qa/detail-cover-20261014/browser";
mkdirSync(output,{recursive:true});
await build({configFile:false,logLevel:"error",define:{"process.env.NODE_ENV":'"production"',__GENZO_ANDROID__:"true"},esbuild:{jsx:"automatic"},build:{outDir:output+"/fixture",lib:{entry:"scripts/fixtures/detail-unification.tsx",name:"CoverFixture",formats:["iife"],fileName:()=>"fixture.js",cssFileName:"fixture"}}});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:412,height:915},reducedMotion:"reduce"}),errors=[],cases=[];
page.on("pageerror",error=>errors.push(String(error)));
try{
 await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
 await page.addStyleTag({content:readFileSync(output+"/fixture/fixture.css","utf8")});await page.addScriptTag({content:readFileSync(output+"/fixture/fixture.js","utf8")});
 for(const [width,height] of [[400,600],[600,800],[400,800],[600,600],[900,600]]){
  await page.evaluate(()=>window.__goto('home'));await page.locator('.gz-shared-anime-hero:visible').waitFor({state:'hidden'});
  await page.evaluate(({width,height})=>{window.__poster(width,height);window.__goto('detail/local');},{width,height});
  const poster=page.locator('.gz-shared-anime-hero:visible .gz-detail-poster');await poster.locator('img').waitFor();await page.waitForTimeout(150);
  const geometry=await poster.evaluate(node=>{const img=node.querySelector('img'),info=node.parentElement.querySelector('.gz-subject-stats');return {poster:node.getBoundingClientRect().toJSON(),image:img.getBoundingClientRect().toJSON(),ratio:img.naturalWidth/img.naturalHeight,info:info.getBoundingClientRect().toJSON()};});
  assert.ok(Math.abs(geometry.poster.width/geometry.poster.height-width/height)<.01);
  assert.ok(Math.abs(geometry.image.width-geometry.poster.width)<1&&Math.abs(geometry.image.height-geometry.poster.height)<1,'no letterboxing');
  if(width/height<=.75)assert.ok(Math.abs(geometry.poster.height-geometry.info.height)<1,'portrait follows the information and follow button height');
  cases.push({ratio:width/height,display:[geometry.poster.width,geometry.poster.height],infoHeight:geometry.info.height});
 }
 await page.evaluate(()=>{window.__safeTop=40;dispatchEvent(new Event('resize'));});await page.waitForTimeout(100);
 const inset=await page.evaluate(()=>{const hero=document.querySelector('.gz-shared-anime-hero'),bg=hero.querySelector('.gz-subject-backdrop');return {padding:parseFloat(getComputedStyle(document.querySelector('.gz-scroll')).paddingTop),top:bg.getBoundingClientRect().top,back:document.querySelector('.gz-back').getBoundingClientRect().top};});
 assert.equal(inset.padding,52);assert.ok(inset.top<=0);assert.ok(inset.back>=40);
 await page.evaluate(()=>window.__poster(600,840));await page.screenshot({path:output+'/cover.png'});
 const layouts=[];for(const width of [360,412,915,1024,1366,1920]){await page.setViewportSize({width,height:915});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);layouts.push(width);}
 assert.deepEqual(errors,[]);const result={cases,inset,layouts,errors};writeFileSync(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
