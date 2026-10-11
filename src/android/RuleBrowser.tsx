import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Play, RefreshCw, Search } from "lucide-react";
import type { WorkDetail } from "../types";
import { rulesApi, type RuleBinding, type RuleBindingPreview, type RuleChapters, type RuleItem, type RulePlugin, type RuleSearch, type WorkRuleSource } from "./rulesApi";
import "./rules.css";

type Result = { plugin: RulePlugin; item: RuleItem };
export function WorkRuleSources({ workId, revision, onOpen }: { workId: string; revision: number; onOpen: (source: WorkRuleSource) => void }) {
  const [sources, setSources] = useState<WorkRuleSource[]>([]);
  useEffect(() => { let active = true; void rulesApi.workSources(workId).then(value => { if (active) setSources(value); }).catch(() => {}); return () => { active = false; }; }, [workId, revision]);
  return sources.length ? <div className="gz-rule-work-sources">{sources.map(source => <button className="gz-link" key={`${source.pluginId}:${source.source}`} onClick={() => onOpen(source)}>管理 {source.name} · {source.title}</button>)}</div> : null;
}
export default function RuleBrowser({ work, pluginId, initialSource, registerBack, onSaved, onBusyChange }: {
  work?: WorkDetail; pluginId?: string; initialSource?: WorkRuleSource;
  registerBack: (handler: (() => boolean) | null) => void;
  onSaved?: () => Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  const [plugins, setPlugins] = useState<RulePlugin[]>([]), [query, setQuery] = useState(work?.title ?? ""), [scope, setScope] = useState(pluginId ?? "all");
  const [results, setResults] = useState<Result[]>([]), [states, setStates] = useState<Record<string, { error?: string; data?: RuleSearch }>>({});
  const [resultsLimit, setResultsLimit] = useState(120), [episodePage, setEpisodePage] = useState(1);
  const [subject, setSubject] = useState<Result | null>(null), [chapters, setChapters] = useState<RuleChapters | null>(null), [road, setRoad] = useState(0);
  const [selected, setSelected] = useState<number[]>([]), [fileStart, setFileStart] = useState("1"), [officialStart, setOfficialStart] = useState("1");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [preview, setPreview] = useState<RuleBindingPreview | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false), [parsing, setParsing] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), resolving = useRef(false);
  useEffect(() => { onBusyChange?.(saving); return () => onBusyChange?.(false); }, [saving, onBusyChange]);
  useEffect(() => {
    let active = true;
    void rulesApi.plugins().then(items => {
      if (!active) return;
      const enabled = items.filter(item => item.enabled); setPlugins(enabled);
      if (initialSource) {
        const plugin = enabled.find(item => item.id === initialSource.pluginId);
        if (plugin) void open({ plugin, item: { name: initialSource.title, source: initialSource.source } });
      } else if (work?.title && enabled.length) void search(enabled, work.title);
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; generation.current++; if (resolving.current) void rulesApi.cancelResolve().catch(() => {}); };
    // A newly opened browser gets one initial search. Subsequent searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    registerBack(() => {
      if (saving) return true;
      if (resolving.current) { generation.current++; resolving.current = false; setParsing(false); void rulesApi.cancelResolve().catch(() => {}); return true; }
      if (preview) { setPreview(null); setAcknowledged(false); return true; }
      if (subject) { generation.current++; setSubject(null); setChapters(null); setLoading(false); return true; }
      return false;
    });
    return () => registerBack(null);
  }, [saving, preview, subject, registerBack]);
  async function search(list = plugins, keyword = query) {
    const value = keyword.trim(); if (!value) return;
    const version = ++generation.current; setLoading(true); setError(""); setResults([]); setResultsLimit(120); setStates({}); setSubject(null); setChapters(null); setPreview(null);
    const queue = list.filter(plugin => scope === "all" || plugin.id === scope);
    const worker = async () => {
      while (queue.length && version === generation.current) {
        const plugin = queue.shift()!;
        try {
          const data = await rulesApi.search(plugin.id, value);
          if (version === generation.current) { setStates(previous => ({ ...previous, [plugin.id]: { data } })); setResults(previous => [...previous, ...data.items.map(item => ({ plugin, item }))]); }
        } catch (reason) { if (version === generation.current) setStates(previous => ({ ...previous, [plugin.id]: { error: String(reason) } })); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker)); if (version === generation.current) setLoading(false);
  }
  async function open(result: Result, fresh = false) {
    const version = ++generation.current; setSubject(result); setChapters(null); setPreview(null); setSelected([]); setRoad(0); setEpisodePage(1); setLoading(true); setError("");
    try { const data = await rulesApi.chapters(result.plugin.id, result.item.source, fresh); if (version === generation.current) setChapters(data); }
    catch (reason) { if (version === generation.current) setError(String(reason)); }
    finally { if (version === generation.current) setLoading(false); }
  }
  function invalidate() { setPreview(null); setAcknowledged(false); setError(""); }
  const episodes = chapters?.roads[road]?.episodes ?? [];
  const pageCount = Math.max(1, Math.ceil(episodes.length / 96)), page = Math.min(episodePage, pageCount), pageStart = (page - 1) * 96;
  const pageEpisodes = episodes.slice(pageStart, pageStart + 96);
  const pageIndexes = pageEpisodes.map((_, index) => pageStart + index), pageSelected = pageIndexes.length > 0 && pageIndexes.every(index => selected.includes(index));
  const validOffset = /^\d+$/.test(fileStart) && /^\d+$/.test(officialStart) && Number(fileStart) <= 9999 && Number(officialStart) <= 9999;
  const input: RuleBinding | null = work && subject ? { workId: work.id, pluginId: subject.plugin.id, source: subject.item.source, title: subject.item.name, roadIndex: road, episodeIndexes: selected, episodeOffset: Number(fileStart) - Number(officialStart), replaceExisting } : null;
  async function inspect() {
    if (!input || !validOffset) return;
    const version = generation.current; setLoading(true); invalidate();
    try { const value = await rulesApi.bindingPreview(input); if (version === generation.current) setPreview(value); }
    catch (reason) { if (version === generation.current) setError(String(reason)); }
    finally { if (version === generation.current) setLoading(false); }
  }
  async function save() {
    if (!input || !preview || !acknowledged) return;
    setSaving(true); setError("");
    try { await rulesApi.bind(input, preview.token); await onSaved?.(); }
    catch (reason) { setError(String(reason)); setPreview(null); setAcknowledged(false); }
    finally { setSaving(false); }
  }
  async function trial(index: number) {
    if (!subject) return;
    const version = generation.current; setParsing(true); resolving.current = true; setError("");
    try { const value = input ? await rulesApi.play({ ...input, episodeIndexes: [index] }) : await rulesApi.preview(subject.plugin.id, subject.item.source, road, index); if (value.error) throw new Error(value.error.message); }
    catch (reason) { if (version === generation.current) setError(String(reason)); }
    finally { if (version === generation.current) { resolving.current = false; setParsing(false); } }
  }
  return <div className="gz-rule-browser">
    {error && <p className="gz-error" role="alert">{error}</p>}
    {!plugins.length && <p className="gz-meta">请先在“来源 → 规则视频来源”安装并启用规则。</p>}
    {!subject ? <>
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="gz-form-fields">
        <label>搜索规则来源<input required maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder="输入作品名称" /></label>
        <label>搜索范围<select value={scope} onChange={event => setScope(event.target.value)}><option value="all">全部已启用规则</option>{plugins.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></label>
        <div className="gz-actions"><button className="gz-btn primary" disabled={!query.trim() || !plugins.length}><Search size={16} />搜索</button>{loading && <button type="button" className="gz-btn" onClick={() => { generation.current++; setLoading(false); }}>停止搜索</button>}</div>
      </form>
      {loading && <p className="gz-meta" role="status">正在搜索，已有结果可直接打开…</p>}
      {plugins.map(plugin => { const state = states[plugin.id]; return state && (state.error || state.data?.verificationRequired || state.data?.warning) ? <div className="gz-panel" key={plugin.id}><strong>{plugin.name}</strong><p className="gz-meta">{state.error ?? state.data?.warning ?? "来源需要网页验证"}</p><button className="gz-btn" onClick={() => void rulesApi.verify(plugin.id, query, state.data?.verificationUrl ?? null).catch(reason => setError(String(reason)))}>打开网页验证</button><p className="gz-meta">完成验证后返回此处重新搜索。</p></div> : null; })}
      {results.slice(0, resultsLimit).map((result, index) => <button className="gz-row-card" key={`${result.plugin.id}:${result.item.source}:${index}`} onClick={() => void open(result)}><span className="gz-row-main"><strong>{result.item.name}</strong><span className="gz-meta">{result.plugin.name}{states[result.plugin.id]?.data?.stale ? " · 缓存结果" : ""}</span></span></button>)}
      {resultsLimit < results.length && <button className="gz-btn" onClick={() => setResultsLimit(value => value + 120)}>显示更多（{Math.min(resultsLimit, results.length)} / {results.length}）</button>}
      {!loading && !!Object.keys(states).length && !results.length && <p className="gz-meta">没有匹配结果，可调整作品名、检查规则状态或更换来源。</p>}
    </> : <>
      <button className="gz-link" disabled={saving} onClick={() => { generation.current++; if (resolving.current) void rulesApi.cancelResolve().catch(() => {}); resolving.current = false; setParsing(false); setSubject(null); setChapters(null); setPreview(null); setLoading(false); }}><ArrowLeft size={16} />返回搜索结果</button>
      <h3>{subject.item.name}</h3><p className="gz-meta">{subject.plugin.name}{work ? ` → ${work.title}` : " · 试播用于测试来源，保存进度请从作品详情关联剧集。"}</p>
      <button className="gz-btn" disabled={loading || saving || parsing} onClick={() => void open(subject, true)}><RefreshCw size={16} />刷新线路与选集</button>
      <button className="gz-link" disabled={saving || parsing} onClick={() => void rulesApi.verify(subject.plugin.id, query, chapters?.verificationUrl ?? null).catch(reason => setError(String(reason)))}>网页验证</button>
      {chapters?.warning && <p className="gz-meta">{chapters.warning}</p>}
      {chapters?.verificationRequired && <button className="gz-btn" onClick={() => void rulesApi.verify(subject.plugin.id, query, chapters?.verificationUrl ?? null).catch(reason => setError(String(reason)))}>打开网页验证</button>}
      {loading && <p role="status" className="gz-meta">正在读取线路与剧集…</p>}
      {!!chapters?.roads.length && <>
        <label>播放线路<select disabled={saving || parsing || loading} value={road} onChange={event => { setRoad(Number(event.target.value)); setEpisodePage(1); setSelected([]); invalidate(); }}>{chapters.roads.map((item, index) => <option key={index} value={index}>{item.name} · {item.episodes.length} 集</option>)}</select></label>
        {work && <><div className="gz-actions"><button className="gz-link" disabled={saving || loading || parsing} onClick={() => { invalidate(); setSelected(previous => pageSelected ? previous.filter(index => !pageIndexes.includes(index)) : [...new Set([...previous, ...pageIndexes])].slice(0, 500)); }}>{pageSelected ? "取消当前页选择" : "选择当前页剧集"}</button><span className="gz-meta">已选 {selected.length} / {episodes.length}</span></div><div className="gz-rule-offset"><label>来源起始集号<input type="number" min={0} max={9999} value={fileStart} disabled={saving || loading || parsing} onChange={event => { setFileStart(event.target.value); invalidate(); }} /></label><label>官方起始集号<input type="number" min={0} max={9999} value={officialStart} disabled={saving || loading || parsing} onChange={event => { setOfficialStart(event.target.value); invalidate(); }} /></label></div><p className="gz-meta">例如来源第 13 集对应官方第 1 集。播放会关联当前这一集并保存进度，也可先预览关联多集，再到剧集页选择规则、本地或 WebDAV 来源。</p><label className="gz-file-choice"><input type="checkbox" checked={replaceExisting} disabled={saving || loading || parsing} onChange={event => { setReplaceExisting(event.target.checked); invalidate(); }} />重新设置已关联剧集的编号</label></>}
        <div className="gz-rule-episodes">{pageEpisodes.map((episode, pageIndex) => { const index = pageStart + pageIndex; return <div className="gz-rule-episode" key={`${episode.url}:${index}`}>{work && <input aria-label={`关联 ${episode.name}`} type="checkbox" disabled={saving || loading || parsing || (!selected.includes(index) && selected.length >= 500)} checked={selected.includes(index)} onChange={event => { invalidate(); setSelected(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index)); }} />}<span className="gz-file-name">{episode.name}</span><button className="gz-btn" aria-label={`${work ? "播放" : "试播"} ${episode.name}`} disabled={parsing || saving || loading || (!!work && !validOffset)} onClick={() => void trial(index)}><Play size={18} />{work ? "播放" : "试播"}</button></div>; })}</div>
        {pageCount > 1 && <div className="gz-actions"><button className="gz-btn" disabled={page <= 1} onClick={() => setEpisodePage(page - 1)}>上一页</button><label>选集页<select aria-label="规则选集页" value={page} onChange={event => setEpisodePage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index} value={index + 1}>{index + 1} / {pageCount}</option>)}</select></label><button className="gz-btn" disabled={page >= pageCount} onClick={() => setEpisodePage(page + 1)}>下一页</button></div>}
        {input && <button className="gz-btn" disabled={!selected.length || !validOffset || saving || loading || parsing} onClick={() => void inspect()}>预览关联（{selected.length} 集）</button>}
      </>}
      {chapters && !chapters.roads.length && !chapters.verificationRequired && <p className="gz-meta">来源暂未提供有效线路，可刷新或选择其他结果。</p>}
      {preview && <section className="gz-panel" aria-label="规则剧集关联预览"><strong>{preview.road} → {preview.title}</strong>{preview.rows.map(row => <p className="gz-file-name" key={row.index}>{row.name} → {row.conflict ? "已关联其他作品，请取消勾选" : row.officialEpisode != null ? `官方第 ${row.officialEpisode} 集 · ${row.officialTitle || "暂无标题"}` : "暂未对应官方分集，关联后可批量核对编号"}{row.existing ? replaceExisting ? " · 按本次编号调整" : " · 保留原有关联与记录" : ""}</p>)}<label className="gz-file-choice"><input type="checkbox" disabled={saving} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />已核对作品、线路与逐集对应</label><button className="gz-btn primary" disabled={saving || !acknowledged || preview.rows.some(row => row.conflict)} onClick={() => void save()}><Check size={16} />确认关联规则剧集</button></section>}
    </>}
    {parsing && <p className="gz-meta" role="status">正在解析播放地址… <button className="gz-link" onClick={() => { generation.current++; resolving.current = false; setParsing(false); void rulesApi.cancelResolve().catch(() => {}); }}>取消解析</button></p>}
  </div>;
}
