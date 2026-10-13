import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { comicExploreApi, novelExploreApi, type CopyComment } from "../comicExplore";
import LoadingIndicator from "./LoadingIndicator";
import "./comicReplies.css";
import AutoLoadSentinel from "./AutoLoadSentinel";
import CommentIdentity from "./CommentIdentity";

export default function ComicReplies({ pathWord, kind, parent }: { pathWord: string; kind: "comic" | "novel"; parent: CopyComment }) {
  const content = kind === "comic" ? comicExploreApi : novelExploreApi;
  const panelId = useId();
  const pending = useRef(false);
  const generation = useRef(0);
  const offset = useRef(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CopyComment[]>([]);
  const [total, setTotal] = useState(parent.replyCount);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => () => { generation.current++; }, []);

  async function load() {
    if (pending.current) return;
    const request = generation.current;
    pending.current = true; setLoading(true); setError(false);
    try {
      const page = await content.replies(pathWord, parent.id, offset.current);
      if (request !== generation.current) return;
      if (page.offset !== offset.current || page.limit <= 0 || (!page.items.length && page.offset < page.total)) throw new Error("Invalid reply page");
      offset.current = page.offset + page.limit;
      setItems(previous => [...new Map([...previous, ...page.items].map(item => [item.id, item])).values()]);
      setTotal(page.total); setLoaded(true);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) { pending.current = false; setLoading(false); }
    }
  }

  function toggle() {
    setOpen(value => !value);
    if (!open && !loaded && !error) void load();
  }

  return <div className="gz-copy-replies">
    <button type="button" className="gz-comment-expand" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{open ? "收起回复" : `展开 ${total} 条回复`}
    </button>
    <div id={panelId} className={`gz-copy-replies-collapse ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="gz-copy-replies-inner">
        <div className="gz-copy-replies-list" role="region" aria-label={`${parent.userName || "匿名用户"}的评论回复`}>
          {items.map(item => <article className="gz-copy-reply" key={item.id}>
            <CommentIdentity name={item.userName} avatar={item.userAvatar} time={item.createAt} />
            {item.parentUserName && <p className="gz-meta">回复 {item.parentUserName}</p>}
            <p className="gz-comment-body">{item.comment}</p>
          </article>)}
          {loading && <LoadingIndicator label="正在读取回复…" compact />}
          {error && <div className="gz-comments-error" role="alert"><p>回复读取失败，请重试。</p><button type="button" className="gz-btn" onClick={() => void load()}>重试回复</button></div>}
          {!loading && !error && loaded && !items.length && <p className="gz-meta">暂无可读取的回复</p>}
          {loaded && offset.current < total && <AutoLoadSentinel enabled={open && !loading && !error} load={() => void load()} />}
        </div>
      </div>
    </div>
  </div>;
}
