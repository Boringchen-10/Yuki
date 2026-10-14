import type { ReactNode } from "react";
import { BookOpen, Library, Star, User } from "lucide-react";
import { useDetailPosterSize } from "./useDetailPosterSize";
import "./detailHeaders.css";

export function AnimeDetailHeader({ title, originalTitle, poster, backdrop, date, rating, votes, rank, episodes, actions, children }: {
  title: string; originalTitle?: string | null; poster: ReactNode; backdrop?: ReactNode;
  date?: string | null; rating?: number | null; votes?: number | null; rank?: number | null;
  episodes?: number | null; actions?: ReactNode; children: ReactNode;
}) {
  const size=useDetailPosterSize();
  return <section className="gz-detail-head gz-anime-hero gz-shared-anime-hero">
    {backdrop && <span className="gz-subject-backdrop" aria-hidden="true">{backdrop}</span>}
    <div className="gz-subject-head"><div className="gz-subject-heading">
      <h1 className="gz-subject-title">{title}</h1>
      {originalTitle && originalTitle !== title && <p className="gz-subject-original">{originalTitle}</p>}
    </div>{actions && <div className="gz-subject-actions">{actions}</div>}</div>
    <div className="gz-subject-body" ref={node=>{size.body.current=node;}}><div className="gz-detail-poster" ref={size.poster}>{poster}</div><div className="gz-subject-stats" ref={size.info}>
      <div className="gz-subject-stat"><span>{votes ? `${votes.toLocaleString()} 人评分` : "评分"}</span><strong className="gz-shared-rating">{rating == null ? "暂无评分" : <><Star size={17} fill="currentColor" />{rating.toFixed(1)}<small>/ 10</small></>}{rank != null && <small className="gz-shared-rank">#{rank}</small>}</strong></div>
      <div className="gz-subject-stat"><span>放送开始</span><strong>{date || "未提供"}</strong></div>
      <div className="gz-subject-stat"><span>剧集</span><strong>{episodes == null ? "—" : `${episodes} 集`}</strong></div>
      {children}
    </div></div>
  </section>;
}

export function BookDetailHeader({ title, originalTitle, poster, backdrop, kind, year, status, authors, tags, count, rating, files, onTag, action }: {
  title: string; originalTitle?: string | null; poster: ReactNode; backdrop?: ReactNode; kind: "comic" | "novel";
  year?: number | null; status?: string; authors?: string[]; tags: string[]; count: number | string;
  rating?: number | null; files?: number; onTag: (tag: string) => void; action?: ReactNode;
}) {
  const size=useDetailPosterSize();
  return <section className="gz-book-head gz-shared-book-hero" ref={size.body}>
    {backdrop && <span className="gz-subject-backdrop" aria-hidden="true">{backdrop}</span>}
    <div className="gz-detail-poster" ref={size.poster}>{poster}</div><div className="gz-book-info" ref={size.info}>
      <h2>{title}</h2>{originalTitle && originalTitle !== title && <p className="gz-meta">{originalTitle}</p>}
      <div className="gz-book-chips"><span className="gz-book-chip">{kind === "comic" ? "漫画" : "轻小说"}</span>{year && <span className="gz-book-chip">{year} 年</span>}{status && <span className="gz-book-chip">{status}</span>}</div>
      {!!authors?.length && <div className="gz-book-pills">{authors.map(author => <span className="gz-book-pill" key={author}><User size={12} />{author}</span>)}</div>}
      {!!tags.length && <div className="gz-book-pills">{tags.map(tag => <button className="gz-book-pill" key={tag} onClick={() => onTag(tag)}><i aria-hidden="true" />{tag}</button>)}</div>}
      <div className="gz-book-stats">{rating != null && <span className="gz-book-stat"><Star size={13} />{rating.toFixed(1)} 分</span>}<span className="gz-book-stat"><BookOpen size={13} />{count} {kind === "comic" ? "话" : "卷"}</span>{files != null && <span className="gz-book-stat"><Library size={13} />{files} 个文件</span>}</div>
      {action}
    </div>
  </section>;
}
