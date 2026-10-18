import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Bookmark, BookOpen, RefreshCw, Trash2 } from "lucide-react";
import LoadingIndicator from "./LoadingIndicator";
import { readingBookmarksApi, type ReadingBookmark } from "./readingBookmarks";
import { readingLocationLabel } from "./readingHistory";
import "./bookmarks.css";
const tabs = [["all", "全部"], ["comic", "漫画"], ["novel", "小说"]] as const;

export default function BookmarkManager({ onRead, registerBack }: { onRead: (item: ReadingBookmark) => void; registerBack: (handler: (() => boolean) | null) => void }) {
  const [items, setItems] = useState<ReadingBookmark[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [kind, setKind] = useState("all"), [query, setQuery] = useState(""), [removing, setRemoving] = useState<ReadingBookmark | null>(null), [pending, setPending] = useState(false);
  const revision = useRef(0), alive = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    const token = ++revision.current; setLoading(true);
    try { const value = await readingBookmarksApi.list(); if (alive.current && revision.current === token) { setItems(value); setError(""); } }
    catch (reason) { if (alive.current && revision.current === token) setError(String(reason)); }
    finally { if (alive.current && revision.current === token) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    let stop: (() => void) | undefined, active = true;
    const changed = () => void refresh();
    void listen("reading-bookmarks-updated", changed).then(value => { if (active) stop = value; else value(); }).catch(() => {});
    window.addEventListener("focus", changed);
    return () => { active = false; alive.current = false; revision.current++; stop?.(); window.removeEventListener("focus", changed); };
  }, [refresh]);
  useEffect(() => {
    registerBack(() => { if (!removing) return false; if (!pending) setRemoving(null); return true; });
    return () => registerBack(null);
  }, [registerBack, removing, pending]);
  useEffect(() => { if (removing) dialog.current?.showModal(); }, [removing]);
  async function remove() {
    if (!removing || pending) return;
    setPending(true); setError(""); revision.current++; setLoading(false);
    try { await readingBookmarksApi.remove(removing.id); if (alive.current) { revision.current++; setLoading(false); setItems(items => items.filter(item => item.id !== removing.id)); setRemoving(null); } }
    catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setPending(false); }
  }
  const needle = query.trim().toLocaleLowerCase();
  const visible = items.filter(item => (kind === "all" || item.kind === kind) && (!needle || `${item.title} ${item.entryTitle} ${item.label}`.toLocaleLowerCase().includes(needle)));
  // Refactoring UI §2.1 / §2.8 / §8.4: saved location and jump are primary;
  // deletion is tertiary. Reuse history rows, 44 dp controls and theme tokens.
  return <section className="gz-bookmarks" aria-label="阅读书签">
    <header className="gz-download-heading"><h2>书签</h2><button type="button" className="gz-iconbtn" aria-label="刷新书签" disabled={loading} onClick={() => void refresh()}><RefreshCw size={20} /></button></header>
    <p className="gz-meta">{items.length ? `${items.length} 个阅读位置，点按即可跳转` : "在漫画或小说阅读器中保存当前位置，即可在这里找到。"}</p>
    {!!items.length && <><label className="gz-bookmark-search"><input aria-label="搜索书签" placeholder="搜索作品、章节或书签" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="gz-shelf-tabs" role="tablist" aria-label="书签类型">{tabs.map(([id, label]) => <button type="button" role="tab" key={id} className={kind === id ? "active" : ""} aria-selected={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div></>}
    {error && !removing && <p className="gz-error" role="alert">{error}</p>}
    {loading && !items.length ? <LoadingIndicator label="正在读取书签…" compact /> : visible.length ? <div role="list" aria-label="已保存的书签">{visible.map(item => <article key={item.id} className="gz-bookmark-row" role="listitem">
      <button type="button" className="gz-bookmark-jump" onClick={() => onRead(item)} aria-label={`跳转书签 ${item.title} ${item.label}`}><span className="gz-bookmark-icon"><Bookmark size={22} aria-hidden="true" /></span><span className="gz-bookmark-body"><strong>{item.title}</strong><span className="gz-meta">{item.label || item.entryTitle}</span><span className="gz-meta">{item.kind === "comic" ? "漫画" : "小说"} · {readingLocationLabel(item)}</span></span><BookOpen size={19} aria-hidden="true" /></button>
      <button type="button" className="gz-iconbtn" aria-label={`删除书签 ${item.title} ${item.label}`} disabled={pending} onClick={() => setRemoving(item)}><Trash2 size={18} /></button>
    </article>)}</div> : !error && <div className="gz-bookmark-empty"><Bookmark size={30} aria-hidden="true" /><h3>{items.length ? "没有匹配的书签" : "还没有阅读书签"}</h3><p className="gz-meta">{items.length ? "试试其他关键词或类型。" : "打开阅读器的书签菜单，选择“添加当前位置”。"}</p></div>}
    {removing && <dialog className="gz-bookmark-confirm" ref={dialog} aria-labelledby="gz-bookmark-delete-title" onCancel={event => { event.preventDefault(); if (!pending) setRemoving(null); }} onClose={() => { if (!pending) setRemoving(null); }}>
      <h2 id="gz-bookmark-delete-title">删除书签</h2><p>{removing.title} · {removing.label}</p><p className="gz-meta">仅删除此书签，阅读进度和下载内容保留。</p>{error && <p className="gz-error" role="alert">{error}</p>}<div className="gz-actions"><button type="button" className="gz-btn" autoFocus disabled={pending} onClick={() => setRemoving(null)}>取消</button><button type="button" className="gz-btn" disabled={pending} onClick={() => void remove()}>{pending ? "正在删除…" : "删除书签"}</button></div>
    </dialog>}
  </section>;
}
