import assert from "node:assert/strict";
import {build} from "vite";
import {chromium} from "playwright-core";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
const output="D:/DevTools/Android/Build/qa/download-bookmarks-20261018/bookmarks-ui";
mkdirSync(output,{recursive:true});
await build({configFile:false,logLevel:"error",define:{"process.env.NODE_ENV":'"production"'},esbuild:{jsx:"automatic"},build:{outDir:`${output}/fixture`,lib:{entry:"scripts/fixtures/bookmarks.tsx",name:"BookmarkFixture",formats:["iife"],fileName:()=>"fixture.js",cssFileName:"fixture"}}});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:375,height:812}}),errors=[],cases=[],layouts=[];
page.on("pageerror",error=>errors.push(String(error)));
const rows=()=>page.getByRole("list",{name:"已保存的书签"}).getByRole("listitem");
try {
  await page.setContent('<html data-platform="android"><body style="margin:0"><div id="root"></div></body></html>');
  await page.addStyleTag({content:readFileSync(`${output}/fixture/fixture.css`,"utf8")});await page.addScriptTag({content:readFileSync(`${output}/fixture/fixture.js`,"utf8")});
  await page.waitForFunction(()=>document.querySelectorAll('[role="listitem"]').length===3);
  await rows().first().getByRole("button",{name:/^跳转书签/}).click();
  assert.equal(await page.evaluate(()=>window.__marks.calls.at(-1).location.pageIndex),2);
  await page.getByRole("tab",{name:"小说",exact:true}).click();assert.equal(await rows().count(),1);
  await rows().getByRole("button",{name:/^跳转书签/}).click();assert.equal(await page.evaluate(()=>window.__marks.calls.at(-1).kind),"novel");
  await page.getByRole("tab",{name:"全部",exact:true}).click();await page.getByRole("textbox",{name:"搜索书签"}).fill("书签2");assert.equal(await rows().count(),1);
  await page.getByRole("textbox",{name:"搜索书签"}).fill("");cases.push("comic/novel filters, search and exact saved-position jump targets");
  for(const theme of ["light","dark"])for(const [width,height] of [[320,568],[375,812],[915,412],[1280,800]]){
    await page.setViewportSize({width,height});await page.evaluate(theme=>document.querySelector(".android-app").dataset.theme=theme,theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await page.locator(".gz-bookmark-row button").evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=44&&r.height>=44;})));
    await page.screenshot({path:`${output}/${theme}-${width}.png`});layouts.push({theme,width,height});
  }
  await page.evaluate(()=>{const nodes=[...document.querySelectorAll('.gz-bookmarks h2,.gz-bookmarks strong,.gz-bookmarks span,.gz-bookmarks p,.gz-bookmarks input,.gz-bookmarks button')];const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));nodes.forEach((node,index)=>node.style.fontSize=`${sizes[index]*1.5}px`);});
  for(const theme of ["light","dark"])for(const [width,height] of [[375,812],[915,412]]){
    await page.setViewportSize({width,height});await page.evaluate(theme=>document.querySelector(".android-app").dataset.theme=theme,theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${output}/font150-${theme}-${width}.png`});layouts.push({theme,width,height,fontScale:150});
  }
  await page.evaluate(()=>document.querySelectorAll('.gz-bookmarks [style]').forEach(node=>node.style.removeProperty('font-size')));
  cases.push("150 percent text remains usable on phone and landscape layouts");
  await page.setViewportSize({width:375,height:812});
  await rows().first().getByRole("button",{name:/^删除书签/}).click();const dialog=page.getByRole("dialog",{name:"删除书签",exact:true});
  assert.equal(await page.evaluate(()=>window.__marks.back()),true);await dialog.waitFor({state:"detached"});assert.equal(await rows().count(),3);
  await rows().first().getByRole("button",{name:/^删除书签/}).click();await page.evaluate(()=>window.__marks.flags(false,true));
  await dialog.getByRole("button",{name:"删除书签",exact:true}).click();await dialog.getByRole("alert").waitFor();assert.equal(await rows().count(),3);
  await page.evaluate(()=>window.__marks.flags(false));await dialog.getByRole("button",{name:"删除书签",exact:true}).click();await dialog.waitFor({state:"detached"});assert.equal(await rows().count(),2);
  cases.push("confirmation/back preserve bookmarks, delete failure recovers and only the chosen bookmark is removed");
  await page.evaluate(()=>window.__marks.flags(true));await page.getByRole("button",{name:"刷新书签"}).click();await page.getByRole("alert").waitFor();assert.equal(await rows().count(),2);
  await page.evaluate(()=>window.__marks.flags(false));await page.getByRole("button",{name:"刷新书签"}).click();await page.getByRole("alert").waitFor({state:"detached"});cases.push("read failure retains the list and retries explicitly");
  await page.evaluate(()=>window.__marks.flags(false,false,true));await page.getByRole("button",{name:"刷新书签"}).click();
  await rows().first().getByRole("button",{name:/^删除书签/}).click();await dialog.getByRole("button",{name:"删除书签",exact:true}).click();await dialog.waitFor({state:"detached"});
  await page.evaluate(()=>{window.__marks.flags(false);window.__marks.resolve();});assert.equal(await rows().count(),1);
  cases.push("late reads cannot restore a deleted bookmark");
  await page.evaluate(()=>window.__marks.mount());await page.waitForFunction(()=>document.querySelectorAll('.gz-bookmark-row').length===3);
  await page.evaluate(()=>window.__marks.flags(false,false,true));await page.getByRole("button",{name:"刷新书签"}).click();
  await rows().first().getByRole("button",{name:/^删除书签/}).click();await page.evaluate(()=>window.__marks.flags(false,true,true));
  await dialog.getByRole("button",{name:"删除书签",exact:true}).click();await dialog.getByRole("alert").waitFor();
  await dialog.getByRole("button",{name:"取消",exact:true}).click();
  await page.evaluate(()=>{window.__marks.flags(false);window.__marks.resolve();});assert.equal(await page.getByRole("button",{name:"刷新书签"}).isEnabled(),true);assert.equal(await rows().count(),3);
  cases.push("a failed deletion during refresh cannot leave the page permanently busy");
  await page.evaluate(()=>window.__marks.mount(true));await page.getByText("还没有阅读书签",{exact:true}).waitFor();assert.equal(await page.getByRole("textbox").count(),0);
  await page.screenshot({path:`${output}/empty-375.png`});cases.push("empty state explains how to add a bookmark and hides unused filters");
  assert.deepEqual(errors,[]);writeFileSync(`${output}/result.json`,JSON.stringify({passed:true,cases,layouts,errors},null,2));console.log(JSON.stringify({passed:true,cases,layouts:layouts.length,output}));
}finally{await browser.close();}
