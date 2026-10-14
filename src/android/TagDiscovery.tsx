import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "../api";
import { comicExploreApi, novelExploreApi, type ComicItem } from "../comicExplore";
import type { ExploreSubject } from "../types";
import AutoLoadSentinel from "./AutoLoadSentinel";
import LoadingIndicator from "./LoadingIndicator";
import { androidSession } from "./sessionCache";
import type { ExploreTagTarget } from "./exploreTagNavigation";

type Results = { anime: ExploreSubject[]; books: ComicItem[]; next: number; total: number; hasMore: boolean; keyword: boolean; stale: boolean };
const empty: Results = { anime: [], books: [], next: 0, total: 0, hasMore: true, keyword: false, stale: false };

export default function TagDiscovery({ target, active, onBack, renderAnime, renderBook }: {
  target: ExploreTagTarget; active: boolean; onBack: () => void;
  renderAnime: (item: ExploreSubject) => ReactNode;
  renderBook: (item: ComicItem, kind: "comic" | "novel") => ReactNode;
}) {
  const key = `discovery:tag:${target.kind}:${target.tag}`;
  const [results, setResults] = useState<Results>(() => androidSession.peek<Results>(key) ?? empty);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), pending = useRef(false), current = useRef(results);
  current.current = results;
  const load = useCallback(async () => {
    if (pending.current || !current.current.hasMore) return;
    const request = generation.current, previous = current.current;
    pending.current = true; setLoading(true); setError("");
    try {
      let next: Results;
      if (target.kind === "anime") {
        const page = await api.searchAnimeTag(target.tag, previous.next);
        const items = new Map(previous.anime.map(item => [item.externalId, item]));
        for (const item of page.items) items.set(item.externalId, item);
        next = { ...previous, anime: [...items.values()], next: page.offset + page.limit, total: page.total, hasMore: page.hasMore, stale: previous.stale || page.stale };
      } else {
        const source = target.kind === "comic" ? comicExploreApi : novelExploreApi;
        const themes = await androidSession.load(`reading:${target.kind}-themes`, () => source.themes());
        const theme = themes.find(item => item.name.trim().toLocaleLowerCase() === target.tag.trim().toLocaleLowerCase());
        const page = await source.list({ query: theme ? "" : target.tag, theme: theme?.pathWord ?? "", top: "", sort: "popular", page: previous.next + 1 });
        const items = new Map(previous.books.map(item => [item.pathWord, item]));
        for (const item of page.items) items.set(item.pathWord, item);
        next = { ...previous, books: [...items.values()], next: page.page, total: page.total, hasMore: page.items.length > 0 && page.page * 24 < page.total, keyword: !theme, stale: previous.stale || page.stale };
      }
      if (request !== generation.current) return;
      current.current = next; setResults(next); androidSession.set(key, next);
    } catch (reason) { if (request === generation.current) setError(String(reason)); }
    finally { if (request === generation.current) { pending.current = false; setLoading(false); } }
  }, [key, target.kind, target.tag]);
  useEffect(() => {
    generation.current++; pending.current = false;
    const initial = androidSession.peek<Results>(key) ?? empty;
    current.current = initial; setResults(initial); setError(""); setLoading(false);
    if (active && !initial.next) void load();
    return () => { generation.current++; };
  }, [key, active, load]);
  const count = target.kind === "anime" ? results.anime.length : results.books.length;
  return <section className="gz-explore" aria-label="标签探索">
    <button className="gz-back" onClick={onBack}><ArrowLeft size={20} />返回发现</button>
    <div className="gz-section-head"><h2>{target.tag}</h2><span className="gz-meta">{target.kind === "anime" ? "动漫" : target.kind === "comic" ? "漫画" : "轻小说"}</span></div>
    <p className="gz-meta">{results.keyword ? "来源没有此分类，当前按同名关键词搜索。" : "来自发现数据源的标签结果"}{results.next > 0 ? ` · ${count}/${results.total}` : ""}{results.stale ? " · 离线缓存" : ""}</p>
    <div className="gz-explore-grid">{target.kind === "anime" ? results.anime.map(renderAnime) : results.books.map(item => renderBook(item, target.kind as "comic" | "novel"))}</div>
    {loading && <LoadingIndicator label="正在探索相关作品…" compact />}
    {error && <div className="gz-error" role="alert"><span>{error}</span><button className="gz-iconbtn" aria-label="重试标签探索" onClick={() => void load()}><RefreshCw size={18} /></button></div>}
    {!loading && !error && results.next > 0 && !count && <p className="gz-panel gz-meta">暂无相关作品，可以返回发现尝试其他标签。</p>}
    <AutoLoadSentinel enabled={active && !loading && !error && results.next > 0 && results.hasMore} load={load} />
  </section>;
}
