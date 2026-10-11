import { useEffect, useState } from "react";
import { episodeArtworkApi } from "../api";
import type { EpisodeArtwork } from "../episodeArtwork";
import { androidSession } from "./sessionCache";
import EpisodeStill from "./EpisodeStill";
import type { AnimeWorkStructure, MediaFile } from "../types";
import { playbackPercent, playbackTime, type PlaybackProgress } from "../playback";
import type { VideoSource } from "./api";

export function episodeSource(file: MediaFile, sources: VideoSource[]) {
  const source = sources.find(source => source.id === file.libraryRootId);
  if (source?.kind === "rule" || file.path.startsWith("rule:")) return "rule";
  return source?.kind === "webdav" || file.path.startsWith("webdav:") ? "webdav" : source?.kind === "saf" || file.path.startsWith("saf:") ? "local" : "other";
}

export default function EpisodeSources({ workId, structure, files, sources, progress, busy, onPlay }: {
  workId?: string;
  structure: AnimeWorkStructure | null; files: MediaFile[]; sources: VideoSource[];
  progress: PlaybackProgress[]; busy: boolean; onPlay: (id: string) => void;
}) {
  const [scope, setScope] = useState("all"), [chosen, setChosen] = useState<Record<string, string>>({});
  const [artwork, setArtwork] = useState<EpisodeArtwork | null>(null), [warning, setWarning] = useState(""), [refreshing, setRefreshing] = useState(false);
  const signature = structure?.episodes.map(episode => `${episode.provider}:${episode.externalId}`).join(",") ?? "";
  useEffect(() => {
    let active = true; setArtwork(null); setWarning("");
    if (!workId || !signature) return;
    void episodeArtworkApi.get(workId).then(cached => { if (active) setArtwork(cached); }).catch(() => {});
    void androidSession.load(`episode-artwork:${workId}:${signature}`, () => episodeArtworkApi.refresh(workId)).then(value => {
      if (active) { setArtwork(value); setWarning(value.warnings.join("；")); }
    }).catch(() => { if (active) setWarning("剧照暂时无法更新，可稍后重试。"); });
    return () => { active = false; };
  }, [workId, signature]);
  async function refreshArtwork() {
    if (!workId) return;
    setRefreshing(true); setWarning("");
    try { const value = await episodeArtworkApi.refresh(workId, true); setArtwork(value); setWarning(value.warnings.join("；")); androidSession.set(`episode-artwork:${workId}:${signature}`, value); }
    catch (reason) { setWarning(String(reason)); } finally { setRefreshing(false); }
  }
  const videos = files.filter(file => file.mediaType === "video");
  const available = (file: MediaFile) => !file.missing && sources.find(source => source.id === file.libraryRootId)?.enabled !== false;
  const linked = new Set(structure?.episodes.flatMap(episode => episode.localFiles.map(file => file.id)));
  const rows = [
    ...(structure?.episodes ?? []).map(episode => ({ key: `${episode.provider}:${episode.externalId}`, title: episode.title || episode.originalTitle || "暂无标题", label: episode.episodeType ? `${({ 1: "特别篇", 2: "OP", 3: "ED", 4: "预告", 5: "MAD", 6: "其他" } as Record<number, string>)[episode.episodeType] ?? "特别篇"} ${episode.sortNumber}` : `第 ${episode.episodeNumber ?? episode.sortNumber} 集`, files: episode.localFiles.filter(file => file.mediaType === "video") })),
    ...videos.filter(file => !linked.has(file.id)).map(file => ({ key: file.id, title: file.fileName, label: structure?.episodes.length ? "未关联官方分集" : file.parsedEpisode ? `第 ${file.parsedEpisode} 集` : "视频文件", files: [file] })),
  ];
  const visible = rows.filter(row => scope === "all" || row.files.some(file => episodeSource(file, sources) === scope));
  return <>
    {workId && signature && <><button className="gz-link" disabled={refreshing} onClick={() => void refreshArtwork()}>{refreshing ? "正在更新剧照…" : "更新分集剧照"}</button>{warning && <p className="gz-meta" role="status">{warning}</p>}</>}
    <div className="gz-chips" role="group" aria-label="剧集播放来源">{([["all", "全部来源"], ["local", "本地"], ["webdav", "WebDAV"], ["rule", "规则来源"]] as const).map(([id, label]) => <button className={`gz-chip${scope === id ? " active" : ""}`} aria-pressed={scope === id} key={id} onClick={() => setScope(id)}>{label}</button>)}</div>
    <div className="gz-episodes">{visible.map(row => {
      const candidates = row.files.filter(file => scope === "all" || episodeSource(file, sources) === scope);
      const recent = [...progress].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).find(saved => candidates.some(file => file.id === saved.mediaFileId && available(file)));
      const file = candidates.find(file => file.id === chosen[row.key] && available(file)) ?? candidates.find(file => file.id === recent?.mediaFileId && available(file)) ?? candidates.find(available) ?? candidates[0];
      const saved = progress.find(saved => saved.mediaFileId === file?.id);
      const sourceName = file ? sources.find(source => source.id === file.libraryRootId)?.label ?? ({ local: "本地", webdav: "WebDAV", rule: "规则来源", other: "其他来源" })[episodeSource(file, sources)] : "暂无文件";
      return <article className="gz-episode" key={row.key}>
        <button className="gz-episode-cover" disabled={busy || !file || !available(file)} aria-label={`播放 ${row.label} ${row.title}`} onClick={() => file && onPlay(file.id)}><EpisodeStill workId={workId} episodeKey={row.key} url={artwork?.images[row.key]} cached={artwork?.cachedImages[row.key]} /><span>{row.label}</span>{saved && <progress max={100} value={playbackPercent(saved)} />}</button>
        <strong>{row.title}</strong>
        {candidates.length > 1 && <label className="gz-meta">选择文件<select aria-label={`${row.label}的播放文件`} disabled={busy} value={file?.id ?? ""} onChange={event => setChosen(previous => ({ ...previous, [row.key]: event.target.value }))}>{candidates.map(file => <option disabled={!available(file)} key={file.id} value={file.id}>{sources.find(source => source.id === file.libraryRootId)?.label ?? episodeSource(file, sources)} · {file.fileName}{!available(file) ? " · 不可用" : ""}</option>)}</select></label>}
        <p className="gz-meta">{sourceName}{file && !available(file) ? " · 来源或文件不可用" : saved?.completed ? " · 已看完" : saved ? ` · 续播 ${playbackTime(saved.positionMs)}` : file ? " · 未播放" : ""}</p>
      </article>;
    })}</div>
    {!visible.length && <p className="gz-panel gz-meta">{rows.length ? "此来源暂未关联视频，可切换其他来源或在待整理中关联文件。" : "尚未关联视频。可在待整理中关联本地或 WebDAV 文件。"}</p>}
  </>;
}
