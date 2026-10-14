import {useEffect,useRef,useState} from "react";
import {Heart} from "lucide-react";
export default function ImmediateBookFavorite({value,persist,preview,onError}:{value:boolean;persist:(next:boolean)=>Promise<void>;preview:(next:boolean)=>void;onError:(error:unknown)=>void}) {
  const [checked,setChecked]=useState(value),[busy,setBusy]=useState(false);const pending=useRef(false);
  useEffect(()=>{if(!pending.current)setChecked(value);},[value]);
  async function toggle(){
    if(pending.current)return;const previous=checked,next=!previous;pending.current=true;setBusy(true);setChecked(next);preview(next);
    try{await persist(next);preview(next);}catch(error){setChecked(previous);preview(previous);onError(error);}finally{pending.current=false;setBusy(false);}
  }
  return <button type="button" className={`gz-book-action ${checked?"active":""}`} aria-pressed={checked} disabled={busy} onClick={()=>void toggle()}><Heart size={18} fill={checked?"currentColor":"none"}/>收藏</button>;
}
