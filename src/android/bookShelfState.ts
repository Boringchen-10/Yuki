import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api";
import type { WorkListItem } from "../types";
export type BookOrder = "collected" | "browsed" | "name";
export interface ShelfEntry { hidden: boolean; browsedAt: string | null; collectedAt: string | null }
export const bookOrders = [{id:"collected" as const,label:"时间顺序",hint:"按加入书架时间，最近在前"},{id:"browsed" as const,label:"浏览时间",hint:"按最近浏览，最近在前"},{id:"name" as const,label:"名称 A–Z",hint:"按作品名称排序"}];
const empty: ShelfEntry = {hidden:false,browsedAt:null,collectedAt:null};
let loading: Promise<void> | null = null;
let viewVersion=0;
const versions=new Map<string,number>();
interface ShelfState {
  entries: Record<string,ShelfEntry>; loaded:boolean; order:BookOrder; favoriteOnly:boolean;
  load:()=>Promise<void>; event:(id:string,action:"browse"|"remove"|"restore")=>Promise<void>;
  view:(order:BookOrder,favoriteOnly:boolean)=>void;
}
export const useBookShelfState=create<ShelfState>((set,get)=>({
  entries:{},loaded:false,order:"collected",favoriteOnly:false,
  load:()=>{
    if(get().loaded)return Promise.resolve();if(loading)return loading;
    const before=new Map(versions);
    const beforeView=viewVersion;
    loading=Promise.all([invoke<Record<string,ShelfEntry>>("get_book_shelf_state"),api.getSetting("android.book-shelf-view")]).then(([entries,value])=>{
      for(const [id,version] of versions){const entry=get().entries[id];if(version!==before.get(id)&&entry)entries[id]=entry;}
      let view:{order?:BookOrder;favoriteOnly?:boolean}={};try{view=JSON.parse(value||"{}");}catch{}
      set({entries,loaded:true,...(beforeView===viewVersion?{order:bookOrders.some(item=>item.id===view.order)?view.order:"collected",favoriteOnly:view.favoriteOnly===true}:{})});
    }).finally(()=>{loading=null;});return loading;
  },
  event:async(id,action)=>{
    const version=(versions.get(id)??0)+1;versions.set(id,version);
    const previous=get().entries[id]??empty;const now=new Date().toISOString();
    const next={...previous,...(action==="browse"?{browsedAt:now}:action==="remove"?{hidden:true}:{hidden:false,collectedAt:previous.hidden?now:previous.collectedAt})};
    set(state=>({entries:{...state.entries,[id]:next}}));
    try{const entry=await invoke<ShelfEntry>("update_book_shelf_state",{workId:id,action});if(versions.get(id)===version)set(state=>({entries:{...state.entries,[id]:entry}}));}
    catch(error){if(versions.get(id)===version)set(state=>({entries:{...state.entries,[id]:previous}}));throw error;}
  },
  view:(order,favoriteOnly)=>{viewVersion++;set({order,favoriteOnly});void api.setSetting("android.book-shelf-view",JSON.stringify({order,favoriteOnly})).catch(()=>{});},
}));
export function sortBooks(items: WorkListItem[], order:BookOrder, entries:Record<string,ShelfEntry>):WorkListItem[] {
  const time=(value:string|null|undefined)=>{const parsed=Date.parse(value??"");return Number.isFinite(parsed)?parsed:0;};
  return [...items].sort((a,b)=>order==="name"?a.title.localeCompare(b.title,"zh-Hans-CN",{numeric:true,sensitivity:"base"}):
    (order==="browsed"?time(entries[b.id]?.browsedAt)-time(entries[a.id]?.browsedAt):0)||time(entries[b.id]?.collectedAt??b.createdAt)-time(entries[a.id]?.collectedAt??a.createdAt)||a.title.localeCompare(b.title));
}
