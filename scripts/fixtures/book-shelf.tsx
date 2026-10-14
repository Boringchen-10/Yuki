import { createRoot } from "react-dom/client";
import AndroidApp from "../../src/android/AndroidApp";
import { api, episodeArtworkApi } from "../../src/api";
import { androidApi } from "../../src/android/api";
import { comicExploreApi, novelExploreApi } from "../../src/comicExplore";
import { rulesApi } from "../../src/android/rulesApi";
import { requestExploreTag } from "../../src/android/exploreTagNavigation";
import "../../src/android/mobile.css";
const qa = window as any;
const works: any[] = [
  { id: "comic-a", title: "Beta 漫画", type: "comic", createdAt: "2025-01-01", updatedAt: "2030-01-01", favorite: false },
  { id: "comic-d", title: "Alpha 漫画", type: "comic", createdAt: "2026-01-01", updatedAt: "2026-01-01", favorite: true },
  { id: "novel-b", title: "Alpha 小说", type: "novel", createdAt: "2026-01-01", updatedAt: "2026-01-01", favorite: true },
  { id: "anime-c", title: "动画样本", type: "video", createdAt: "2026-01-01", updatedAt: "2026-01-01", favorite: false },
].map(item => ({ originalTitle: null, category: "anime", description: "简介", coverPath: null, status: "planned", rating: 9, notes: "保留笔记", tags: ["冒险"], mediaCount: 0, missingCount: 0, mediaFiles: [], metadata: null, fieldLocks: [], candidates: [], subtitleLinks: [], ...item }));
const entries: Record<string, any> = {};
qa.__calls = []; qa.__deleteCount = 0; qa.__tagFailure = false; qa.__slowTag = false;
qa.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener:()=>{}};
qa.__tag = requestExploreTag;
qa.__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: any = {}) => {
    if (command === "get_book_shelf_state") return structuredClone(entries);
    if (command === "update_book_shelf_state") {
      const old = entries[args.workId] ?? {hidden:false,browsedAt:null,collectedAt:null};
      entries[args.workId] = {...old, ...(args.action === "remove" ? {hidden:true} : args.action === "restore" ? {hidden:false,collectedAt:old.hidden ? new Date().toISOString() : old.collectedAt} : {browsedAt:new Date().toISOString()})};
      return structuredClone(entries[args.workId]);
    }
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten") return;
    if (command === "list_reading_sources") return [];
    return [];
  },
  transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value: string) => value,
};
api.listWorks = async filters => works.filter(item => !filters?.type || item.type === filters.type);
api.listUnassignedGroups = async () => []; api.getSetting = async () => null; api.setSetting = async () => {};
api.getWork = async id => structuredClone(works.find(item => item.id === id));
api.deleteWork = async () => { qa.__deleteCount++; };
let finishFavorite: ((fail: boolean) => void) | undefined;
api.setFavorite = async (id, favorite) => {
  qa.__calls.push({kind:"favorite",id,favorite});
  await new Promise<void>((resolve,reject) => { finishFavorite = fail => fail ? reject(new Error("隔离保存失败")) : resolve(); });
  const item=works.find(item=>item.id===id); if(item)item.favorite=favorite;
};
qa.__finishFavorite = (fail=false) => finishFavorite?.(fail);
api.getAnimeWorkStructure = async () => ({workId:"anime-c",bangumiId:null,seasons:[],episodes:[],unmatchedFiles:[],staff:[],characters:[],warnings:[]} as any);
androidApi.sources = async () => []; androidApi.tasks = async () => []; androidApi.imports = async () => [];
androidApi.appearance = async () => {}; androidApi.safeArea = async () => ({top:0,bottom:0,left:0,right:0});
androidApi.progress = async () => ({items:[],sessions:[]}); rulesApi.workSources = async () => [];
episodeArtworkApi.get = async () => ({anchor:"qa",source:null,images:{},cachedImages:{},warnings:[],correspondence:[],sourceTitle:null});
const subject = (id: string, title: string): any => ({externalId:id,title,originalTitle:null,coverUrl:null,genres:["冒险"],favorite:false,localWorkId:null,description:"简介",subjectType:"tv",sourceKeys:["bangumi"],stale:false,score:8,ratingCount:0,collectionCount:0});
api.getExploreSubject = async id => subject(id, `标签动画 ${id}`);
api.searchAnimeTag = async (tag,offset=0) => {
  qa.__calls.push({kind:"anime-tag",tag,offset});
  if(qa.__slowTag&&tag==="慢标签")await new Promise<void>(resolve=>{qa.__finishSlowTag=resolve;});
  if(qa.__tagFailure)throw new Error("隔离标签失败");
  return {items:[subject(String(offset+1),`${tag==="冒险"?"":tag+" "}标签动画 ${offset+1}`)],total:25,offset,limit:20,hasMore:offset===0,stale:false};
};
api.animePopular = async () => ({items:[subject("123","热门动画")],totalPages:1,page:1,pageSize:24,hasMore:false,stale:false});
api.weeklyCalendar = async () => ({days:[],generatedAt:"2026-10-14",sourceVersion:"qa"});
const book = (pathWord: string, title: string, id: string|null = null): any => ({pathWord,title,coverUrl:null,authors:[],tags:["冒险"],summary:"简介",status:"连载中",updatedAt:"2026",latestChapter:"",localWorkId:id,favorite:works.find(item=>item.id===id)?.favorite??false});
for(const [kind,source] of [["comic",comicExploreApi],["novel",novelExploreApi]] as const){
  source.themes = async () => [{name:"冒险",pathWord:`${kind}-adventure`}];
  source.save = async () => kind==="comic"?"comic-a":"novel-b";
  source.list = async input => {
    qa.__calls.push({kind:`${kind}-list`,...input});
    return {items:[book(`${kind}-${input.page}`,`${kind} 标签作品 ${input.page}`)],page:input.page,total:25,stale:false};
  };
  source.detail = async path => ({item:book(path,`${kind} 标签作品`,kind==="comic"?"comic-a":"novel-b"),aliases:[],chapterCount:0,stale:false});
}
comicExploreApi.home = async () => ({sections:[],stale:false});
qa.__goto = (route: string) => { location.hash=`#/${route}`; };
qa.__snapshot = () => ({works:structuredClone(works),entries:structuredClone(entries),deletes:qa.__deleteCount});
history.replaceState({},"","#/bookshelf");
createRoot(document.getElementById("root")!).render(<AndroidApp/>);
