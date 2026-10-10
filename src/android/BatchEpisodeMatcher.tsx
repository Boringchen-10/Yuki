import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, Search } from "lucide-react";
import { api, correctionApi } from "../api";
import { correctionAdvice, reliableCorrectionIds, type CorrectionInput, type CorrectionPreview } from "../recognitionPreferences";
import type { AnimeWorkStructure, WorkDetail } from "../types";

const officialLabel = (row: CorrectionPreview["rows"][number]) => `官方${row.episodeType ? ` ${["", "特别篇", "OP", "ED", "预告", "MAD", "其他"][row.episodeType] ?? "特别篇"} ` : ""}第 ${row.episode} 集`;

export default function BatchEpisodeMatcher({ work, structure, onSaved, onBusyChange }: {
  work: WorkDetail; structure: AnimeWorkStructure | null;
  onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const [includeLinked, setIncludeLinked] = useState(false), [mode, setMode] = useState<"parsed" | "sequence">("parsed");
  const [fileStart, setFileStart] = useState("1"), [officialStart, setOfficialStart] = useState("1"), [season, setSeason] = useState("");
  const [updatedStructure, setUpdatedStructure] = useState<AnimeWorkStructure | null>(null);
  const [assessment, setAssessment] = useState<CorrectionPreview | null>(null), [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const request = useRef(0);
  const currentStructure = updatedStructure ?? structure;
  const videos = useMemo(() => work.mediaFiles.filter(file => file.mediaType === "video"), [work.mediaFiles]);
  const linked = useMemo(() => new Set(currentStructure?.episodes.flatMap(episode => episode.localFiles.map(file => file.id))), [currentStructure]);
  const available = useMemo(() => videos.filter(file => !file.missing && (includeLinked || !linked.has(file.id))), [videos, linked, includeLinked]);
  const files = useMemo(() => available.slice(0, 500), [available]);
  const numberValid = (value: string) => /^\d+$/.test(value) && Number(value) <= 9999;
  const valid = numberValid(officialStart) && (mode !== "parsed" || numberValid(fileStart)) && (season === "" || numberValid(season) && Number(season) <= 999);
  const offset = mode === "parsed" ? Number(fileStart) - Number(officialStart) : 0;
  const input: CorrectionInput = { sourceWorkId: work.id, targetWorkId: work.id, mediaFileIds: selected, mode, startEpisode: Number(officialStart), season: season === "" ? null : Number(season), episodeType: 0, episodeOffset: offset };
  useEffect(() => { onBusyChange(saving); return () => onBusyChange(false); }, [saving, onBusyChange]);
  useEffect(() => {
    const version = ++request.current;
    setPreview(null); setAssessment(null); setChecked(false); setError(""); setSelected([]);
    if (!files.length || !valid) { setLoading(false); return; }
    setLoading(true);
    void correctionApi.inspect({ sourceWorkId: work.id, targetWorkId: work.id, mediaFileIds: files.map(file => file.id), mode, startEpisode: Number(officialStart), season: season === "" ? null : Number(season), episodeType: 0, episodeOffset: offset }).then(value => {
      if (version !== request.current) return;
      setAssessment(value); setSelected(reliableCorrectionIds(value.rows));
    }).catch(reason => { if (version === request.current) setError(String(reason)); })
      .finally(() => { if (version === request.current) setLoading(false); });
    return () => { request.current++; };
  }, [work.id, files, mode, officialStart, season, offset, valid, revision]);
  function invalidate() { setPreview(null); setChecked(false); setError(""); }
  async function inspect() {
    const version = request.current; setLoading(true); invalidate();
    try { const value = await correctionApi.preview(input); if (version === request.current) setPreview(value); }
    catch (reason) { if (version === request.current) setError(String(reason)); }
    finally { if (version === request.current) setLoading(false); }
  }
  async function refresh() {
    const version = request.current; setLoading(true); invalidate();
    try {
      const value = await api.refreshWorkMetadata(work.id);
      if (version !== request.current) return;
      setUpdatedStructure(value); setRevision(value => value + 1);
    } catch (reason) { if (version === request.current) setError(String(reason)); }
    finally { if (version === request.current) setLoading(false); }
  }
  async function save() {
    if (!preview || !checked || !preview.rows.every(row => row.officialEpisodeId && row.eligible !== false)) return;
    setSaving(true); setError("");
    try { await correctionApi.apply(input, preview.token); await onSaved(); }
    catch (reason) { setError(String(reason)); setPreview(null); setChecked(false); }
    finally { setSaving(false); }
  }
  const rows = new Map(assessment?.rows.map(row => [row.id, row]));
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <p><strong>{work.title}</strong></p>
    <p className="gz-meta">按当前作品的官方分集匹配。比如文件 13–24 对应官方 1–12，设置文件起始 13、官方起始 1，再逐行核对。文件名、原始集号与观看位置保留。</p>
    {error && <p className="gz-error" role="alert">{error}<br />{correctionAdvice(error).text}</p>}
    <fieldset className="gz-form-fields" disabled={loading || saving}>
      <label>匹配方式<select value={mode} onChange={event => setMode(event.target.value as "parsed" | "sequence")}><option value="parsed">按文件集号对应</option><option value="sequence">按文件名自然排序连续匹配</option></select></label>
      {mode === "parsed" && <label>文件起始集号<input type="number" min={0} max={9999} value={fileStart} onChange={event => setFileStart(event.target.value)} /></label>}
      <label>对应官方起始集号<input type="number" min={0} max={9999} value={officialStart} onChange={event => setOfficialStart(event.target.value)} /></label>
      <label>作品季度（可选）<input type="number" min={0} max={999} placeholder="按作品资料核对" value={season} onChange={event => setSeason(event.target.value)} /></label>
      {!valid && <p className="gz-error">请填写有效的起始集号和季度。</p>}
      <label className="gz-file-choice"><input type="checkbox" checked={includeLinked} onChange={event => setIncludeLinked(event.target.checked)} />显示已关联文件，供重新核对</label>
      <p className="gz-meta">{videos.length} 个视频 · {videos.filter(file => !linked.has(file.id)).length} 个未关联 · 本次 {files.length} 个可用文件</p>
      {available.length > 500 && <p className="gz-meta">每次最多处理 500 个；保存后可继续处理剩余未关联文件。</p>}
      <div className="gz-actions"><button type="button" className="gz-btn" onClick={() => void refresh()}><RefreshCw size={16} />刷新官方分集</button><button type="button" className="gz-link" disabled={!assessment} onClick={() => { invalidate(); setSelected(assessment ? reliableCorrectionIds(assessment.rows) : []); }}>仅选择可靠对应</button></div>
      {files.map(file => { const row = rows.get(file.id); return <label className="gz-file-choice" key={file.id}><input type="checkbox" checked={selected.includes(file.id)} disabled={!row?.officialEpisodeId || row.eligible === false} onChange={event => { invalidate(); setSelected(previous => event.target.checked ? [...previous, file.id] : previous.filter(id => id !== file.id)); }} /><span className="gz-file-name"><strong>{file.fileName}</strong><span className="gz-meta" style={{ display: "block" }}>文件第 {row?.parsedEpisode ?? "?"} 集 → {row?.officialEpisodeId ? `${officialLabel(row)} · ${row.officialTitle || "暂无标题"}` : "暂无唯一官方对应"}</span>{row?.issues?.filter(issue => issue.code !== "still_missing").map(issue => <span className="gz-meta" style={{ display: "block" }} key={issue.code}>{issue.message}</span>)}</span></label>; })}
      {!files.length && <p className="gz-meta">{videos.length ? "没有可处理的未关联文件；可显示已关联文件重新核对，或检查来源是否可用。" : "作品尚未关联视频，请先在待整理中关联文件。"}</p>}
      <button type="button" className="gz-btn" disabled={!valid || !selected.length} onClick={() => void inspect()}><Search size={16} />预览匹配（{selected.length} 个）</button>
      {preview && <section aria-label="批量剧集匹配预览">
        <h3>将 {preview.rows.length} 个文件匹配到《{preview.title}》</h3>
        {preview.rows.map(row => <div className="gz-correction-row" key={row.id}><strong className="gz-file-name">{row.fileName}</strong><p className="gz-meta">文件第 {row.parsedEpisode ?? "?"} 集 → {officialLabel(row)} · {row.officialTitle || "暂无唯一对应"}</p></div>)}
        {preview.warnings.map(warning => <p className="gz-meta" key={warning}>{warning}</p>)}
        <label className="gz-file-choice"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />已核对文件与官方分集的逐行对应</label>
      </section>}
      <button className="gz-btn primary" type="submit" disabled={!preview || !checked || !preview.rows.every(row => row.officialEpisodeId && row.eligible !== false)}><Check size={16} />确认批量匹配</button>
    </fieldset>
    {loading && <p className="gz-meta" role="status">正在核对分集…</p>}
  </form>;
}
