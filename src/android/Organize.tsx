import { useEffect, useRef, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { api } from "../api";
import { candidateKind, initialFilmSelection, fileSeason } from "../filmTvRecognition";
import { selectedVideo, selectionGroups } from "../recognitionSelection";
import type { MatchCandidate, MediaFile, RecognitionGroupScope, RecognitionKind, WorkListItem } from "../types";

export default function Organize({ mediaId, initialTitle, linkedWorkId, works, busy, onRun, onDone, onSkip }: {
  mediaId: string; initialTitle: string; linkedWorkId?: string; works: WorkListItem[]; busy: boolean;
  onRun: (operation: () => Promise<void>) => void; onDone: (workId?: string) => Promise<void>; onSkip?: () => void;
}) {
  const [title, setTitle] = useState(initialTitle), [query, setQuery] = useState(initialTitle);
  const [kind, setKind] = useState<RecognitionKind>("anime"), [scope, setScope] = useState<RecognitionGroupScope>("season");
  const [members, setMembers] = useState<MediaFile[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]), [preview, setPreview] = useState<MatchCandidate | null>(null);
  const [season, setSeason] = useState(1), [target, setTarget] = useState(works[0]?.id ?? "");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const request = useRef(0);
  const [searching, setSearching] = useState(false), [searchError, setSearchError] = useState("");
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setPreview(null);
    Promise.all([api.listRecognitionGroupMembers(mediaId, scope), api.listMatchCandidates(mediaId)]).then(([context, choices]) => {
      if (!active) return;
      setFolder((context.folderPath ?? "当前目录").replace(/^(?:webdav|saf):\/\/[^/\\]+[/\\]?/, "").replaceAll("\\", "/"));
      const representative = context.members.find(file => file.id === mediaId);
      if (!representative) throw new Error("文件范围已变化，请重新打开目录。");
      const nextKind = choices.length ? candidateKind(choices[0]) : kind;
      const nextSeason = fileSeason(representative) ?? 1;
      setMembers(context.members); setKind(nextKind); setSeason(nextSeason);
      setSelected(initialFilmSelection(context.members.filter(file => !file.missing), representative, nextKind, nextSeason));
      setCandidates(choices); setLoading(false);
    }).catch(reason => { if (active) { setError(String(reason)); setLoading(false); } });
    return () => { active = false; request.current++; };
    // Scope changes reload the server range. Type/season changes only change selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, scope]);
  const selectable = members.filter(file => (!file.workId || file.workId === linkedWorkId) && !file.missing);
  const representative = selectedVideo(selectable, selected, mediaId);
  const disabled = busy || loading || searching || !!error;
  function choose(ids: string[]) { setSelected(ids); setCandidates([]); setPreview(null); }
  function changeType(value: RecognitionKind, number = season) {
    setKind(value); setSeason(number);
    const preferred = members.find(file => file.id === mediaId);
    if (preferred) choose(initialFilmSelection(selectable, preferred, value, number));
  }
  async function search() {
    if (!representative) return;
    const version = ++request.current;
    setSearching(true); setSearchError("");
    try {
      setPreview(null); setCandidates([]);
      const result = await api.recognizeMedia(representative.id, query, kind, kind === "tv" ? season : undefined);
      if (version !== request.current) return;
      if (result.status === "matched") await onDone();
      else setCandidates(result.candidates);
      if (result.error) throw new Error(result.error);
    } catch (reason) { if (version === request.current) setSearchError(String(reason)); }
    finally { if (version === request.current) setSearching(false); }
  }
  return <>
    <p className="gz-file-name"><strong>当前识别文件夹：</strong>{folder || "来源根目录"}</p>
    <p className="gz-meta">核对文件范围后关联作品；文件保留在原目录。</p>
    {loading && <p role="status">正在读取文件范围…</p>}{error && <p className="gz-error" role="alert">{error}</p>}
    {searchError && <p className="gz-error" role="alert">{searchError}</p>}
    {!linkedWorkId && <label>整理范围<select aria-label="整理范围" disabled={busy || loading} value={scope} onChange={event => setScope(event.target.value as RecognitionGroupScope)}><option value="season">当前季度 / 特别篇</option><option value="folder">整个作品文件夹</option></select></label>}
    <details className="gz-panel" open><summary>本次文件范围 · {selected.length}/{members.length} 个</summary><button type="button" className="gz-link" disabled={disabled} onClick={() => choose(selected.length ? [] : selectable.map(file => file.id))}>{selected.length ? "清空选择" : "全选可关联文件"}</button>{members.map(file => <label className="gz-file-choice" key={file.id}><input type="checkbox" disabled={disabled || !selectable.includes(file)} checked={selected.includes(file.id)} onChange={event => choose(event.target.checked ? [...selected, file.id] : selected.filter(id => id !== file.id))} /><span className="gz-file-name">{file.fileName}{file.missing ? " · 不可用" : file.workId && file.workId !== linkedWorkId ? " · 已关联其他作品" : ""}</span></label>)}</details>
    {selectionGroups(selectable.filter(file => selected.includes(file.id))).length > 1 && <p className="gz-meta">当前选择包含不同季度或特别篇，请按对应 Bangumi 条目分别关联。</p>}
    <form onSubmit={event => { event.preventDefault(); void search(); }}>
      <label>搜索作品资料<input required disabled={disabled} value={query} onChange={event => { setQuery(event.target.value); setCandidates([]); setPreview(null); }} /></label>
      <label>资料类型<select disabled={disabled} value={kind} onChange={event => changeType(event.target.value as RecognitionKind)}><option value="anime">动漫 · Bangumi</option><option value="movie">电影 · TMDB</option><option value="tv">电视剧 · TMDB</option></select></label>
      {kind === "tv" && <label>季度<input aria-label="电视剧季度" disabled={disabled} type="number" min={0} max={999} value={season} onChange={event => changeType(kind, Number(event.target.value))} /></label>}
      <button className="gz-btn" disabled={disabled || !query.trim() || !representative}><Search size={18} />{searching ? "正在查找…" : "查找候选"}</button>
    </form>
    <div className="gz-candidates">{candidates.filter(candidate => candidateKind(candidate) === kind).map(candidate => <div className="gz-panel" key={candidate.id}><strong>{candidate.title}</strong><p className="gz-meta">{candidate.originalTitle} · {candidate.year ?? "年份未知"} · 匹配度 {Math.round(candidate.confidence * 100)}%</p><p className="gz-meta">{candidate.matchReasons.join("；")}</p><button className="gz-btn" disabled={disabled || !selected.includes(candidate.mediaFileId)} onClick={() => setPreview(candidate)}>预览关联</button></div>)}</div>
    {preview && <section className="gz-panel" aria-label="关联预览"><strong>将 {selected.length} 个文件关联到《{preview.title}》</strong><p className="gz-meta">{preview.provider} #{preview.externalId}{preview.season != null ? ` · 第 ${preview.season} 季` : ""}，未勾选的文件保留原归属。</p>{members.filter(file => selected.includes(file.id)).map(file => <p className="gz-file-name" key={file.id}>{file.fileName}</p>)}<button className="gz-btn primary" disabled={disabled || !selected.includes(preview.mediaFileId)} onClick={() => onRun(async () => onDone(await api.confirmMatch(preview.mediaFileId, preview.id, selected, scope)))}><Check size={16} />确认关联</button></section>}
    {!linkedWorkId && <form onSubmit={event => { event.preventDefault(); if (!representative) return; onRun(async () => { const work = await api.createWorkFromMedia(representative.id, { title: title.trim(), originalTitle: null, type: "video", description: "", coverPath: null, status: "planned", favorite: false, rating: null, notes: "", tags: [] }, selected); await onDone(work.id); }); }}><label>手动创建作品<input required disabled={disabled} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label><button className="gz-btn" disabled={disabled || !title.trim() || !representative}><Plus size={16} />创建并整理所选文件</button></form>}
    {!linkedWorkId && works.length > 0 && <form onSubmit={event => { event.preventDefault(); onRun(async () => { await api.attachMediaFiles(target, selected); await onDone(target); }); }}><label>归入已有作品<select disabled={disabled} value={target} onChange={event => setTarget(event.target.value)}>{works.map(work => <option key={work.id} value={work.id}>{work.title}</option>)}</select></label><button className="gz-btn" disabled={disabled || !target || !representative}>关联所选文件</button></form>}
    {onSkip && <button className="gz-btn" disabled={busy} onClick={onSkip}>跳过，整理下一项</button>}
  </>;
}
