import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BookOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { readingLocationLabel, type ReadingHistoryItem } from "./readingHistory";

export default function ReadingHistoryRow({ item, editing = false, busy = false, onRead, onDetail, onRemove, onMore }: {
  item: ReadingHistoryItem;
  editing?: boolean;
  busy?: boolean;
  onRead: (item: ReadingHistoryItem) => void;
  onDetail: (item: ReadingHistoryItem) => void;
  onRemove: (item: ReadingHistoryItem) => void;
  onMore?: (item: ReadingHistoryItem) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const cover = item.coverPath ? (/^(https?:|asset:|data:|blob:)/.test(item.coverPath) ? item.coverPath : convertFileSrc(item.coverPath)) : item.coverUrl;
  const thumb = <span className="gz-history-thumb">{cover && failed !== cover ? <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setFailed(cover)} /> : <BookOpen aria-hidden="true" />}</span>;
  return <article className="gz-history-row">
    {item.workId ? <button type="button" className="gz-history-thumbbtn" onClick={() => onDetail(item)} aria-label={`查看 ${item.title}`}>{thumb}</button> : thumb}
    <div className="gz-history-body">
      <strong className="gz-truncate">{item.title}</strong>
      <p className="gz-meta gz-truncate">{item.entryTitle}</p>
      <p className="gz-meta gz-history-when">{readingLocationLabel(item)}</p>
      <p className="gz-meta gz-history-src">{item.kind === "comic" ? "漫画" : "小说"} · {new Date(item.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
    </div>
    {editing ? <button type="button" className="gz-history-del" disabled={busy} onClick={() => onRemove(item)} aria-label={`移除 ${item.title} 的记录`} title="移除记录"><Trash2 size={18} /></button>
      : <div className="gz-history-actions">
        <button type="button" className="gz-history-play" disabled={busy} onClick={() => onRead(item)} aria-label={`继续阅读 ${item.title} ${item.entryTitle}`} title="继续阅读"><BookOpen size={18} /></button>
        {onMore && <button type="button" className="gz-iconbtn gz-history-more" onClick={() => onMore(item)} aria-label="更多操作" title="更多操作"><MoreHorizontal size={18} /></button>}
      </div>}
  </article>;
}
