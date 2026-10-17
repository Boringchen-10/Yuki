import { useState } from "react";
import { Check, Download, MoreHorizontal, Sparkles, Unlink } from "lucide-react";
import { downloadEntryApi } from "./downloadEntryApi";
import type { EpisodeArtwork } from "../episodeArtwork";
import EpisodeStill from "./EpisodeStill";
import type { AnimeEpisodeMetadata, AnimeWorkStructure, MediaFile } from "../types";
import { playbackPercent, playbackTime, type PlaybackProgress } from "../playback";
import { pathBaseName, pathDirName } from "../mediaPaths";
import type { VideoSource } from "./api";

export function episodeSource(file: MediaFile, sources: VideoSource[]) {
  const source = sources.find(source => source.id === file.libraryRootId);
  if (source?.kind === "rule" || file.path.startsWith("rule:")) return "rule";
  return source?.kind === "webdav" || file.path.startsWith("webdav:") ? "webdav" : source?.kind === "saf" || file.path.startsWith("saf:") ? "local" : "other";
}

const sourceNames: Record<string, string> = { local: "本地", webdav: "WebDAV", rule: "规则来源", other: "其他来源" };
export const episodeSourceLabel = (file: MediaFile, sources: VideoSource[]) => sources.find(source => source.id === file.libraryRootId)?.label ?? sourceNames[episodeSource(file, sources)];
const parentFolderName = (file: MediaFile) => { const dir = pathDirName(file.path); return dir ? pathBaseName(dir) : ""; };

export default function EpisodeSources({ workId, subjectId, structure, files, sources, progress, artwork, warning, busy, onPlay, onOpenPlaySource, onUnlinkEpisode, onDetachWork, onRecognizeOther }: {
  workId?: string; subjectId?: string;
  structure: AnimeWorkStructure | null; files: MediaFile[]; sources: VideoSource[];
  progress: PlaybackProgress[]; artwork: EpisodeArtwork | null; warning?: string; busy: boolean; onPlay: (id: string) => void;
  onOpenPlaySource?: (episode?: AnimeEpisodeMetadata) => void;
  onUnlinkEpisode?: (mediaFileId: string) => void; onDetachWork?: (mediaFileId: string) => void; onRecognizeOther?: (mediaFileId: string) => void;
}) {
  const [scope, setScope] = useState("all"), [chosen, setChosen] = useState<Record<string, string>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [downloadPending, setDownloadPending] = useState(false), [downloadMessage, setDownloadMessage] = useState("");
  const videos = files.filter(file => file.mediaType === "video");
  const hasLocalOrWebdav = videos.some(file => { const kind = episodeSource(file, sources); return kind === "local" || kind === "webdav"; });
  const available = (file: MediaFile) => !file.missing && sources.find(source => source.id === file.libraryRootId)?.enabled !== false;
  const linked = new Set(structure?.episodes.flatMap(episode => episode.localFiles.map(file => file.id)));
  const rows = [
    ...(structure?.episodes ?? []).map(episode => ({ key: `${episode.provider}:${episode.externalId}`, episode: true, target: episode, title: episode.title || episode.originalTitle || "暂无标题", label: episode.episodeType ? `${({ 1: "特别篇", 2: "OP", 3: "ED", 4: "预告", 5: "MAD", 6: "其他" } as Record<number, string>)[episode.episodeType] ?? "特别篇"} ${episode.sortNumber}` : `第 ${episode.episodeNumber ?? episode.sortNumber} 集`, files: episode.localFiles.filter(file => file.mediaType === "video") })),
    ...videos.filter(file => !linked.has(file.id)).map(file => ({ key: file.id, episode: false, target: undefined, title: file.fileName, label: structure?.episodes.length ? "未关联官方分集" : file.parsedEpisode ? `第 ${file.parsedEpisode} 集` : "视频文件", files: [file] })),
  ];
  const visible = rows.filter(row => scope === "all" || row.files.some(file => episodeSource(file, sources) === scope));
  const cards = visible.map(row => {
    const candidates = row.files.filter(file => scope === "all" || episodeSource(file, sources) === scope);
    const recent = [...progress].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).find(saved => candidates.some(file => file.id === saved.mediaFileId && available(file)));
    const file = candidates.find(file => file.id === chosen[row.key] && available(file)) ?? candidates.find(file => file.id === recent?.mediaFileId && available(file)) ?? candidates.find(available) ?? candidates[0];
    const saved = progress.find(saved => saved.mediaFileId === file?.id);
    return { row, candidates, file, saved };
  });
  const open = openKey ? cards.find(card => card.row.key === openKey) ?? null : null;
  const sheetRow = open?.row ?? null, sheetCandidates = open?.candidates ?? [], sheetFile = open?.file ?? null;
  const fileStatus = (file: MediaFile | undefined, saved: PlaybackProgress | undefined) => !file ? "" : !available(file) ? " · 来源或文件不可用" : saved?.completed ? " · 已看完" : saved ? ` · 续播 ${playbackTime(saved.positionMs)}` : " · 未播放";
  async function downloadFile(file: MediaFile) {
    if (downloadPending) return;
    setDownloadPending(true); setDownloadMessage("");
    try {
      if (episodeSource(file,sources)==="rule") await downloadEntryApi.ruleMedia(file.id);
      else await downloadEntryApi.file(file.id);
      setDownloadMessage("已加入下载中心");
    } catch (reason) { setDownloadMessage(String(reason)); }
    finally { setDownloadPending(false); }
  }
  return <>
    {downloadMessage && <p className="gz-meta" role="status">{downloadMessage}</p>}
    {warning && <p className="gz-meta" role="status">{warning}</p>}
    {(workId || videos.length > 0 || onOpenPlaySource) && <div className="gz-chips" role="group" aria-label="剧集播放来源">{([["all", "全部来源"], ["local", "本地"], ["webdav", "WebDAV"], ["rule", "规则来源"]] as const).map(([id, label]) => <button className={`gz-chip${scope === id ? " active" : ""}`} aria-pressed={scope === id} key={id} onClick={() => { if (id === "rule") { onOpenPlaySource?.(); return; } setScope(id); if (id === "all" && !hasLocalOrWebdav) onOpenPlaySource?.(); }}>{label}</button>)}</div>}
    <div className="gz-episodes" key={scope}>{cards.map(({ row, file, saved }) => <article className="gz-episode" key={row.key}>
      <button className="gz-episode-cover" disabled={busy || ((!file || !available(file)) && !onOpenPlaySource)} aria-label={`播放 ${row.label} ${row.title}`} onClick={() => { if (file && available(file)) onPlay(file.id); else onOpenPlaySource?.(row.target); }}><EpisodeStill workId={workId} subjectId={subjectId} episodeKey={row.key} url={artwork?.images[row.key]} cached={artwork?.cachedImages[row.key]} /><span>{row.label}</span>{saved && <progress max={100} value={playbackPercent(saved)} />}</button>
      <strong>{row.title}</strong>
      <div className="gz-episode-foot">
        <span className="gz-meta">{file ? episodeSourceLabel(file, sources) : "暂无文件"}{fileStatus(file, saved)}</span>
        {(onUnlinkEpisode || onDetachWork || onRecognizeOther || row.files.length > 1 || (file && ["rule","webdav"].includes(episodeSource(file,sources)))) && <button type="button" className="gz-episode-more" aria-label={`${row.label} 设置`} aria-haspopup="dialog" disabled={busy} onClick={() => setOpenKey(row.key)}><MoreHorizontal size={18} /></button>}
      </div>
    </article>)}</div>
    {!visible.length && <p className="gz-panel gz-meta">{rows.length ? "此来源暂未关联视频，可切换其他来源或在待整理中关联文件。" : "尚未关联视频。可在待整理中关联本地或 WebDAV 文件。"}</p>}
    {sheetRow && <div className="gz-scrim" onClick={() => setOpenKey(null)}><section className="gz-sheet gz-episode-sheet" role="dialog" aria-modal="true" aria-label={`${sheetRow.label} 设置`} onClick={event => event.stopPropagation()}>
      <span className="gz-sheet-handle" aria-hidden="true" />
      <h2 className="gz-sheet-title gz-truncate">{sheetRow.label} · {sheetRow.title}</h2>
      <p className="gz-meta">文件来源</p>
      <div className="gz-source-list" role="radiogroup" aria-label="文件来源">
        {sheetCandidates.length ? sheetCandidates.map(file => {
          const current = sheetFile?.id === file.id, enabled = available(file);
          return <button type="button" key={file.id} role="radio" aria-checked={current} disabled={busy || !enabled} className={`gz-source-row${current ? " active" : ""}`} onClick={() => { setChosen(previous => ({ ...previous, [sheetRow.key]: file.id })); setOpenKey(null); }}>
            <span className="gz-source-main"><strong>{episodeSourceLabel(file, sources)}</strong><span className="gz-meta gz-source-file">{file.fileName}</span>{parentFolderName(file) && <span className="gz-meta gz-source-folder">上级文件夹：{parentFolderName(file)}</span>}</span>
            {current ? <Check className="gz-source-check" size={18} /> : enabled ? null : <span className="gz-meta">不可用</span>}
          </button>;
        }) : <p className="gz-meta">这一项暂无可选文件。</p>}
      </div>
      <div className="gz-episode-actions">
        {sheetFile && ["rule","webdav"].includes(episodeSource(sheetFile,sources)) && <button type="button" disabled={busy || downloadPending || !available(sheetFile)} onClick={() => void downloadFile(sheetFile)}><Download size={18} />{downloadPending ? "正在加入…" : "下载此视频"}</button>}
        {sheetRow.episode && sheetFile && <button type="button" disabled={busy} onClick={() => { const id = sheetFile.id; setOpenKey(null); onUnlinkEpisode?.(id); }}><Unlink size={18} />解除分集关联</button>}
        {sheetFile && <button type="button" disabled={busy} onClick={() => { const id = sheetFile.id; setOpenKey(null); onDetachWork?.(id); }}><Unlink size={18} />解除作品关联</button>}
        {sheetFile && <button type="button" disabled={busy || sheetFile.missing} onClick={() => { const id = sheetFile.id; setOpenKey(null); onRecognizeOther?.(id); }}><Sparkles size={18} />识别到其他作品</button>}
      </div>
    </section></div>}
  </>;
}
