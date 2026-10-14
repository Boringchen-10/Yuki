import {useEffect,useState} from "react";
import {MoreHorizontal,Trash2,X} from "lucide-react";
import {useBookShelfState} from "./bookShelfState";
import "./bookDetailMenu.css";
export default function BookDetailMenu({workId,onRemoved,onError}:{workId:string|null;onRemoved:()=>void;onError:(error:unknown)=>void}) {
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false);const hidden=useBookShelfState(state=>workId?state.entries[workId]?.hidden:false);
  useEffect(()=>{setOpen(false);},[workId]);
  useEffect(()=>{if(!open)return;const close=()=>{if(!pending)setOpen(false);};window.addEventListener("genzo-book-shelf-close",close);return()=>window.removeEventListener("genzo-book-shelf-close",close);},[open,pending]);
  async function remove(){if(pending||!workId)return;setPending(true);try{await useBookShelfState.getState().event(workId,"remove");setOpen(false);onRemoved();}catch(error){onError(error);}finally{setPending(false);}}
  return <><button type="button" className="gz-iconbtn" aria-label="书架设置" aria-haspopup="dialog" onClick={()=>setOpen(true)}><MoreHorizontal size={22}/></button>
    {open&&<div className="gz-scrim" onClick={()=>!pending&&setOpen(false)}><section className="gz-sheet" data-book-shelf-menu role="dialog" aria-modal="true" aria-label="书架设置" onClick={event=>event.stopPropagation()}>
      <div className="gz-section-head"><h2>书架设置</h2><button type="button" className="gz-iconbtn" aria-label="关闭书架设置" disabled={pending} onClick={()=>setOpen(false)}><X size={20}/></button></div>
      <button type="button" className="gz-btn gz-book-remove" disabled={pending||!workId||hidden} onClick={()=>void remove()}><Trash2 size={18}/>移除书架</button><p className="gz-meta">{!workId||hidden?"此作品当前不在书架。":"收藏、评分、阅读进度和下载都会保留，可随时重新加入。"}</p>
    </section></div>}</>;
}
