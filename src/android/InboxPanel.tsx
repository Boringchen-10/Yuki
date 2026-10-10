import { useEffect, useState } from "react";
import { ChevronRight, Cloud, Film, Folder, RefreshCw } from "lucide-react";
import type { UnassignedMediaGroup } from "../types";
import { androidApi, type VideoSource } from "./api";
import { androidSession } from "./sessionCache";
import { inboxDirectory, inInboxDirectory } from "./inboxDirectory";

export default function InboxPanel({ groups, sources, busy, activeSources = [], onOpen, onRun, onRefresh, registerBack }: {
  groups: UnassignedMediaGroup[]; sources: VideoSource[]; busy: boolean;
  activeSources?: string[];
  onOpen: (group: UnassignedMediaGroup, remaining?: UnassignedMediaGroup[]) => void;
  onRun: (operation: () => Promise<void>) => void; onRefresh: () => Promise<void>;
  registerBack: (handler: (() => boolean) | null) => void;
}) {
  const [source, setSource] = useState<string | null>(() => androidSession.peek<string | null>("inbox:source") ?? null), [path, setPath] = useState<string[]>(() => androidSession.peek<string[]>("inbox:path") ?? []);
  useEffect(() => { androidSession.set("inbox:source", source); androidSession.set("inbox:path", path); }, [source, path]);
  useEffect(() => {
    registerBack(() => { if (path.length) { setPath(value => value.slice(0, -1)); return true; } if (source) { setSource(null); return true; } return false; });
    return () => registerBack(null);
  }, [source, path, registerBack]);
  const scoped = source ? groups.filter(group => inInboxDirectory(group, source, path)) : groups;
  const processing = scoped.some(group => activeSources.includes(group.representative.libraryRootId ?? ""));
  const direct = source ? scoped.filter(group => inboxDirectory(group).length === path.length) : [];
  const folders = [...new Set(scoped.map(group => inboxDirectory(group)[path.length]).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const sourceRows = [...new Set(groups.map(group => group.representative.libraryRootId).filter((id): id is string => !!id))];
  function autoRecognize() {
    const queue = scoped.filter(group => group.missingCount < group.fileCount);
    if (!queue.length || processing) return;
    onRun(async () => {
      const ids = [...new Set(queue.map(group => group.representative.libraryRootId).filter((id): id is string => !!id))];
      await androidApi.importSources(ids, false, queue.map(group => group.representative.id));
      await onRefresh();
    });
  }
  return <>
    <p className="gz-meta">{groups.length} 组待整理。自动识别只关联可靠且无歧义的动漫；其余按文件夹核对。</p>
    <nav className="gz-breadcrumb" aria-label="待整理目录"><button className="gz-crumb" disabled={!source || busy} onClick={() => { setSource(null); setPath([]); }}>全部来源</button>{source && <><ChevronRight size={14} /><button className="gz-crumb" disabled={!path.length || busy} onClick={() => setPath([])}>{sources.find(item => item.id === source)?.label ?? "视频来源"}</button>{path.map((part, index) => <span key={index}><ChevronRight size={14} /><button className="gz-crumb" disabled={busy || index === path.length - 1} onClick={() => setPath(path.slice(0, index + 1))}>{part}</button></span>)}</>}</nav>
    <div className="gz-actions"><button className="gz-btn primary" disabled={busy || processing || !scoped.length} onClick={autoRecognize}><RefreshCw size={16} />{source ? "自动识别此目录" : "连续识别动漫"}（{scoped.length} 组）</button><button className="gz-btn" disabled={busy || processing || !scoped.length} onClick={() => { if (scoped[0]) onOpen(scoped[0], scoped.slice(1)); }}>逐个整理{source ? "此目录" : "剩余项目"}</button></div>
    <p className="gz-meta">自动识别在后台进行，可切换页面；点击任务提示查看当前文件夹与进度。</p>
    {!source ? sourceRows.map(id => { const item = sources.find(item => item.id === id); const count = groups.filter(group => group.representative.libraryRootId === id).length; return <button className="gz-row-card" disabled={busy} key={id} onClick={() => { setSource(id); setPath([]); }}>{item?.kind === "webdav" ? <Cloud /> : <Folder />}<span className="gz-row-main"><strong>{item?.label ?? "视频来源"}</strong><span className="gz-meta">{count} 组待整理 · {item?.kind === "webdav" ? "WebDAV" : "本地"}</span></span><ChevronRight size={18} /></button>; }) : <>
      {folders.map(folder => <button className="gz-row-card" key={folder} disabled={busy} onClick={() => setPath([...path, folder])}><Folder /><span className="gz-row-main"><strong>{folder}</strong><span className="gz-meta">{scoped.filter(group => inboxDirectory(group)[path.length] === folder).length} 组</span></span><ChevronRight size={18} /></button>)}
      {direct.map(group => <button className="gz-row-card" key={group.key} disabled={busy || activeSources.includes(group.representative.libraryRootId ?? "")} onClick={() => onOpen(group)}><Film /><span className="gz-row-main"><strong>{group.title}</strong><span className="gz-meta">{group.fileCount} 个文件 · {group.representative.fileName}</span>{group.representative.recognitionError && <span className="gz-meta">{group.representative.recognitionError}</span>}</span><span className="gz-badge warn">{group.recognitionStatus === "candidate_pending" ? "待确认" : group.recognitionStatus === "error" ? "识别失败" : "待识别"}</span></button>)}
    </>}
    {!scoped.length && <p className="gz-panel gz-meta">此范围没有待整理的视频。可返回上级目录或扫描来源。</p>}
  </>;
}
