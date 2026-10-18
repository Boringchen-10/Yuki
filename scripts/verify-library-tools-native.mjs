import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {chromium} from "playwright-core";
const app="com.genzo.android.libraryqa",data=`/data/user/0/${app}`,adb="D:/DevTools/Android/Sdk/platform-tools/adb.exe",serial="3B164M00Z0500000";
// The temporary DEBUG QA copy maps the existing readerqa inspection guard to
// libraryqa. Production sources and their QA-only guards remain unchanged.
const output="D:/DevTools/Android/Build/qa/download-bookmarks-20261018",port=9351;
const owner=JSON.parse(readFileSync(`${output}/device-session.json`,"utf8").replace(/^\uFEFF/,""));
assert.equal(owner.createdForThisTest,true);assert.equal(owner.package,app);
const run=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",timeout:30000,maxBuffer:8*1024**2});
const binary=(...args)=>execFileSync(adb,["-s",serial,...args],{timeout:30000,maxBuffer:32*1024**2});
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const first=run("shell","dumpsys","package",app).match(/firstInstallTime=(.+)/)?.[1].trim();assert.equal(first,owner.firstInstallTime);
run("shell","am","start","-n",`${app}/com.genzo.android.MainActivity`);await delay(1200);
const pid=run("shell","pidof",app).trim();assert.match(pid,/^\d+$/);
run("forward",`tcp:${port}`,`localabstract:webview_devtools_remote_${pid}`);
let browser;
for(let i=0;i<40;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});break;}catch{await delay(250);}}
assert.ok(browser,"Owned QA WebView must expose its debug endpoint");
const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));assert.ok(page);
await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const native=(command,payload={})=>invoke("android_native",{command,payload});
const info=await invoke("get_app_info");assert.equal(info.dataDirectory,data);
async function until(predicate,label){for(let i=0;i<160;i++){const state=await native("readerState");if(predicate(state))return state;assert.notEqual(state.status,"error",JSON.stringify(state));await delay(150);}throw new Error(label);}
const control=async(action,value=0)=>{const state=await native("readerState");return native("readerControl",{sessionId:state.sessionId,action,value});};
async function screenshot(name){await delay(500);writeFileSync(`${output}/${name}.png`,binary("exec-out","screencap","-p"));}
const result={package:app,dataDirectory:data,cases:{}};
try{
  if(process.argv.includes("--seed")){
    assert.equal((await invoke("list_works")).length,0,"Only an empty, newly created QA library may be seeded");
    const storage=await invoke("get_download_storage"),external=storage.locations.find(item=>item.id!=="internal");assert.ok(external);
    assert.ok(external.path.startsWith(`/storage/`)&&external.path.includes(`/Android/data/${app}/files/`));
    await browser.close();browser=null;run("shell","am","force-stop",app);
    const local=`${output}/${app}`;mkdirSync(local,{recursive:true});
    writeFileSync(`${local}/owned-fixture.json`,JSON.stringify({createdForThisTest:true}));
    for(const name of ["genzo.db","genzo.db-wal"]){try{writeFileSync(`${local}/${name}`,binary("exec-out","run-as",app,"cat",name));}catch(error){if(name==="genzo.db")throw error;}}
    execFileSync("C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",["scripts/fixtures/android-library-tools-seed.py",local],{stdio:"pipe"});
    const stage="/data/local/tmp/yuki-libraryqa-fixtures";
    run("push",`${local}/genzo.db`,`${stage}.db`);run("push",`${local}/reading-cache`,`${stage}-internal`);run("push",`${local}/external-reading-cache`,`${stage}-external`);
    run("shell","run-as",app,"rm","-f","genzo.db-wal","genzo.db-shm");
    run("shell","run-as",app,"cp",`${stage}.db`,`${data}/genzo.db`);
    run("shell","run-as",app,"cp","-R",`${stage}-internal`,`${data}/reading-cache`);
    run("push",`${local}/external-reading-cache`,`${external.path}/reading-cache`);
    writeFileSync(`${output}/fixture-storage.json`,JSON.stringify({external,marks:JSON.parse(readFileSync(`${local}/bookmark-ids.json`,"utf8"))},null,2));
    console.log("Seeded only the owned libraryqa profile with generated CBZ/EPUB and bookmarks");
  }else if(process.argv.includes("--restart-check")){
    const external=JSON.parse(readFileSync(`${output}/fixture-storage.json`,"utf8")).external;
    assert.equal((await invoke("get_download_storage")).selected,external.id);
    assert.equal((await invoke("list_reading_bookmarks")).length,2);
    assert.equal((await invoke("list_download_jobs")).filter(job=>job.state==="completed").length,2);
    await page.getByRole("button",{name:"我的",exact:true}).click();await page.getByRole("button",{name:/^书签/}).click();
    await page.getByRole("list",{name:"已保存的书签"}).waitFor();await screenshot("native-final-bookmarks");
    await page.getByRole("button",{name:"我的",exact:true}).click();await page.getByRole("button",{name:/^下载中心/}).click();
    await page.getByRole("button",{name:"下载设置",exact:true}).click();const dialog=page.getByRole("dialog",{name:"下载设置",exact:true});
    await page.waitForFunction(id=>document.querySelector('select[aria-label="下载目录"]')?.value===id,external.id);
    await screenshot("native-final-download-settings");
    run("shell","input","keyevent","4");await dialog.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>location.hash),"#/downloads");
    writeFileSync(`${output}/native-restart.json`,JSON.stringify({passed:true,storagePersisted:true,bookmarksRetained:true,archivesRetained:true,systemBackClosesSettings:true},null,2));
    console.log("Storage, bookmarks and offline archives survive process restart; Android back closes settings first");
  }else{
    await page.locator(".android-app").waitFor();
    const agree=page.getByRole("button",{name:"同意并继续",exact:true});
    if(await agree.count()){await page.getByRole("checkbox").check();await agree.click();await page.getByRole("button",{name:"暂不添加，进入 Yuki",exact:true}).click();}
    await page.getByRole("button",{name:"我的",exact:true}).click();assert.equal(await page.getByRole("button",{name:"下载设置",exact:true}).count(),0);
    const before=await invoke("list_reading_bookmarks");assert.equal(before.length,2);
    await page.getByRole("button",{name:/^书签/}).click();
    for(const kind of ["comic","novel"]){
      const mark=before.find(item=>item.kind===kind);await page.getByRole("button",{name:`跳转书签 ${mark.title} ${mark.label}`,exact:true}).click();
      const state=await until(s=>s.status==="ready"&&s.rendered&&s.kind===kind&&(kind==="comic"?s.location?.pageIndex===2:s.location?.href?.includes("chapter-1.xhtml")),"Bookmark must restore its own saved location");
      assert.equal(state.offline,true);await screenshot(`native-${kind}-bookmark`);result.cases[`${kind}BookmarkLocation`]=state.location;
      if(kind==="comic"){
        await control("seek",.8);await delay(600);await control("bookmarks");await delay(400);
        run("shell","uiautomator","dump","/data/local/tmp/yuki-libraryqa-dialog.xml");
        const xml=run("shell","cat","/data/local/tmp/yuki-libraryqa-dialog.xml");
        const node=(xml.match(/<node\b[^>]*>/g)||[]).find(node=>node.includes('text="添加当前位置"'));assert.ok(node);
        const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(b);run("shell","input","tap",String((+b[1]+ +b[3])/2|0),String((+b[2]+ +b[4])/2|0));
        for(let i=0;i<30;i++){if((await invoke("list_reading_bookmarks")).length===3)break;await delay(150);}assert.equal((await invoke("list_reading_bookmarks")).length,3);
        result.cases.readerAddsBookmark=true;
      }
      await control("close");await until(s=>s.status==="closed","Reader closes");await delay(700);
    }
    const extra=(await invoke("list_reading_bookmarks")).find(item=>!before.some(old=>old.id===item.id));assert.ok(extra);
    const progress=await invoke("list_reading_history");
    await page.getByRole("button",{name:`删除书签 ${extra.title} ${extra.label}`,exact:true}).click();await page.getByRole("dialog",{name:"删除书签",exact:true}).getByRole("button",{name:"删除书签",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.gz-bookmark-row').length===2);
    assert.deepEqual(await invoke("list_reading_history"),progress);result.cases.deletePreservesProgress=true;
    await page.getByRole("button",{name:"我的",exact:true}).click();await page.getByRole("button",{name:/^下载中心/}).click();
    await page.getByRole("button",{name:"下载设置",exact:true}).click();const dialog=page.getByRole("dialog",{name:"下载设置",exact:true});
    const external=JSON.parse(readFileSync(`${output}/fixture-storage.json`,"utf8")).external;
    await dialog.getByRole("combobox",{name:"下载目录",exact:true}).selectOption(external.id);await screenshot("native-download-settings");
    await dialog.getByRole("button",{name:"保存下载设置",exact:true}).click();await dialog.waitFor({state:"detached"});
    assert.equal((await invoke("get_download_storage")).selected,external.id);
    const jobs=await invoke("list_download_jobs");assert.equal(jobs.filter(job=>job.state==="completed").length,2);result.cases.oldArchivesAcrossVolumes=true;
    result.cases.selectedStorage=external.id;writeFileSync(`${output}/native-result.json`,JSON.stringify({...result,passed:true},null,2));console.log(JSON.stringify({passed:true,...result}));
  }
}catch(error){await screenshot("native-failure");writeFileSync(`${output}/native-failure.json`,JSON.stringify({...result,error:String(error)},null,2));throw error;}
finally{if(browser)await browser.close();run("forward","--remove",`tcp:${port}`);}
