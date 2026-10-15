import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../api";
import { androidSession } from "./sessionCache";
import "./bangumiCommentImages.css";

export function splitBangumiImages(value: string): { value: string; image: boolean }[] {
  const result: { value: string; image: boolean }[] = [];
  const pattern = /\[img(?:=[^\]]*)?\]\s*((?:https?:)?\/\/[^\s\[\]]+)\s*\[\/img\]/gi;
  let end = 0;
  let count = 0;
  for (const match of value.matchAll(pattern)) {
    if (count++ === 4) break;
    if (match.index > end) result.push({ value: value.slice(end, match.index), image: false });
    const source = match[1]!;
    const url = source.startsWith("//") ? `https:${source}` : source.replace(/^http:\/\//i, "https://");
    result.push({ value: url, image: true });
    end = match.index + match[0].length;
  }
  if (end < value.length) result.push({ value: value.slice(end), image: false });
  return result;
}

function CommentImage({ url }: { url: string }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [picture, setPicture] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const key = `bangumi:comment-image:${url}`;
    setPicture(null); setFailed(false);
    const load = () => {
      void androidSession.load(key, () => api.bangumiCommentImage(url)).then(path => {
        if (!active) return;
        if (path) setPicture(path); else setFailed(true);
      }).catch(() => { if (active) setFailed(true); });
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: "200px" });
    if (frame.current) observer.observe(frame.current);
    return () => { active = false; observer.disconnect(); };
  }, [url, attempt]);
  const retry = () => { androidSession.invalidate(`bangumi:comment-image:${url}`); setAttempt(value => value + 1); };
  return <span ref={frame} className="gz-bangumi-image">
    {picture && !failed ? <img src={picture} alt="评论图片" decoding="async" onError={() => setFailed(true)} />
      : failed ? <button type="button" className="gz-bangumi-image-retry" onClick={retry}><RefreshCw size={16} />图片加载失败，重试</button>
        : <span className="gz-meta" role="status">图片加载中…</span>}
  </span>;
}

export default function BangumiCommentBody({ value }: { value: string }) {
  return <div className="gz-comment-body">{splitBangumiImages(value).map((part, index) => part.image
    ? <CommentImage key={`${index}:${part.value}`} url={part.value} /> : <span key={index}>{part.value}</span>)}</div>;
}
