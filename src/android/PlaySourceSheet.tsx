import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, LoaderCircle, MoreHorizontal, Play, RefreshCw, X } from "lucide-react";
import type { AnimeEpisodeMetadata, WorkDetail } from "../types";
import { usePreferences } from "../store";
import { rulesApi, type RuleChapters, type RuleItem, type RulePlugin, type RuleSearch } from "./rulesApi";
import "./rules.css";

type Result = { plugin: RulePlugin; item: RuleItem };
type SourceState = { status: "searching" | "error" | "empty" | "ready"; data?: RuleSearch; error?: string };

export default function PlaySourceSheet({ work, title = work?.title ?? "", episode, resolveWork, onClose, onToast }: { work?: WorkDetail; title?: string; episode?: AnimeEpisodeMetadata; resolveWork?: () => Promise<WorkDetail>; onClose: () => void; onToast?: (message: string) => void }) {
  const [plugins, setPlugins] = useState<RulePlugin[]>([]);
  const [states, setStates] = useState<Record<string, SourceState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [subject, setSubject] = useState<Result | null>(null);
  const [chapters, setChapters] = useState<RuleChapters | null>(null);
  const [road, setRoad] = useState(0);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const handedToPlayer = useRef(false);
  const playPending = useRef(false);

  useEffect(() => {
    let active = true;
    void rulesApi.plugins().then(items => {
      if (!active) return;
      const order = usePreferences.getState().ruleOrder, rank = new Map(order.map((id, index) => [id, index]));
      const enabled = items.filter(item => item.enabled).sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
      setPlugins(enabled);
      if (enabled.length) void search(enabled, title);
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; generation.current++; if (!handedToPlayer.current) void rulesApi.cancelResolve().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(list: RulePlugin[], keyword: string) {
    const value = keyword.trim(); if (!value) return;
    const version = ++generation.current;
    setError(""); setSubject(null); setChapters(null); setExpanded(null);
    setStates(Object.fromEntries(list.map(plugin => [plugin.id, { status: "searching" } as SourceState])));
    const queue = [...list];
    const worker = async () => {
      while (queue.length && version === generation.current) {
        const plugin = queue.shift()!;
        try {
          const data = await rulesApi.search(plugin.id, value);
          if (version === generation.current) setStates(previous => ({ ...previous, [plugin.id]: { status: data.items.length ? "ready" : "empty", data } }));
        } catch (reason) { if (version === generation.current) setStates(previous => ({ ...previous, [plugin.id]: { status: "error", error: String(reason) } })); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }

  async function open(result: Result) {
    const version = ++generation.current; setSubject(result); setChapters(null); setRoad(0); setLoading(true); setError(""); setMenu(null);
    try { const data = await rulesApi.chapters(result.plugin.id, result.item.source); if (version === generation.current) setChapters(data); }
    catch (reason) { if (version === generation.current) setError(String(reason)); }
    finally { if (version === generation.current) setLoading(false); }
  }

  async function play(index: number) {
    if (!subject || playPending.current) return;
    playPending.current = true;
    const version = generation.current; setPlaying(true); setError("");
    try {
      const target = work ?? await resolveWork?.();
      if (version !== generation.current) return;
      if (!target) throw new Error("作品资料暂不可用，请关闭后重试。");
      const value = await rulesApi.play({ workId: target.id, pluginId: subject.plugin.id, source: subject.item.source, title: subject.item.name, roadIndex: road, episodeIndexes: [index], episodeOffset: 0, targetEpisodeExternalId: episode?.externalId });
      if (value.error) throw new Error(value.error.message);
      if (version !== generation.current) return;
      handedToPlayer.current = true;
      onToast?.("正在打开播放器…"); onClose();
    } catch (reason) { if (version === generation.current) setError(String(reason)); }
    finally { playPending.current = false; if (version === generation.current) setPlaying(false); }
  }

  function retry(plugin: RulePlugin) { void search([plugin], title); }
  function backToList() { generation.current++; setSubject(null); setChapters(null); setLoading(false); setError(""); }

  const total = useMemo(() => plugins.reduce((sum, plugin) => sum + (states[plugin.id]?.data?.items.length ?? 0), 0), [plugins, states]);
  const done = plugins.filter(plugin => { const state = states[plugin.id]; return !!state && state.status !== "searching"; }).length;
  const episodes = chapters?.roads[road]?.episodes ?? [];
  const episodeLabel = episode ? `${episode.episodeType ? ({ 1: "特别篇", 2: "OP", 3: "ED", 4: "预告", 5: "MAD", 6: "其他" } as Record<number, string>)[episode.episodeType] ?? "其他" : "第"} ${episode.episodeNumber ?? episode.sortNumber}${episode.episodeType ? "" : " 集"}${episode.title ? ` · ${episode.title}` : ""}` : "";
  const statusLabel = (state?: SourceState) => {
    if (!state || state.status === "searching") return "检索中…";
    if (state.status === "error") return "检索失败";
    if (state.status === "empty") return state.data?.warning ?? state.data?.verificationRequired ? "需要网页验证" : "无结果";
    return `${state.data?.items.length} 个结果`;
  };

  return <div className="gz-scrim" onClick={onClose}><section className="gz-sheet gz-play-source" role="dialog" aria-modal="true" aria-label="播放来源" onClick={event => event.stopPropagation()}>
    <span className="gz-sheet-handle" aria-hidden="true" />
    <div className="gz-play-source-head">
      <h2 className="gz-sheet-title">播放来源</h2>
      <button type="button" className="gz-iconbtn" aria-label="关闭" onClick={onClose}><X size={20} /></button>
    </div>
    <div className="gz-play-source-view" key={subject ? `subject:${subject.plugin.id}:${subject.item.source}` : "list"}>
    {!subject && <p className="gz-play-source-summary" role="status">{plugins.length ? `${done < plugins.length ? `检索中 ${done}/${plugins.length}` : "检索完成"} · ${total} 个结果` : "暂无已启用的规则来源"}</p>}
    {error && <p className="gz-error" role="alert">{error}</p>}
    {episode && <p className="gz-meta">正在选择：{episodeLabel}。请核对来源作品、线路与对应剧集后播放。</p>}
    {!work && resolveWork && <p className="gz-meta">开始播放时会加入媒体库并保存观看记录。</p>}
    {!subject && <>
      {!plugins.length && <p className="gz-meta">请在“我的 → 规则设置”安装并启用规则。</p>}
      <div className="gz-play-source-list">
        {plugins.map(plugin => {
          const state = states[plugin.id];
          const items = state?.data?.items ?? [];
          const isOpen = expanded === plugin.id;
          return <div className="gz-play-source-group" key={plugin.id}>
            <div className={`gz-play-source-row${isOpen ? " is-open" : ""}`}>
              <button type="button" className="gz-play-source-main" aria-expanded={isOpen} disabled={!items.length} onClick={() => setExpanded(isOpen ? null : plugin.id)}>
                <span className="gz-play-source-name">{plugin.name}</span>
                <span className="gz-play-source-status">{state?.status === "searching" && <LoaderCircle className="gz-spin" size={14} aria-hidden="true" />}{statusLabel(state)}</span>
                {items.length ? <ChevronDown className="gz-play-source-caret" size={16} aria-hidden="true" /> : null}
              </button>
              <button type="button" className="gz-iconbtn gz-play-source-more" aria-label={`${plugin.name} 更多操作`} aria-haspopup="menu" aria-expanded={menu === plugin.id} onClick={() => setMenu(menu === plugin.id ? null : plugin.id)}><MoreHorizontal size={18} /></button>
              {menu === plugin.id && <div className="gz-rule-menu" role="menu">
                <button type="button" role="menuitem" disabled={state?.status === "searching"} onClick={() => { setMenu(null); retry(plugin); }}><RefreshCw size={16} />重新检索</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(null); void rulesApi.verify(plugin.id, title, state?.data?.verificationUrl ?? null).catch(reason => setError(String(reason))); }}><ExternalLink size={16} />网页验证</button>
              </div>}
            </div>
            {isOpen && items.length ? <div className="gz-play-source-results">
              {items.map((item, index) => <button type="button" className="gz-play-source-result" key={`${item.source}:${index}`} onClick={() => void open({ plugin, item })}><span className="gz-truncate">{item.name}</span><ChevronRight size={16} aria-hidden="true" /></button>)}
            </div> : null}
          </div>;
        })}
      </div>
    </>}
    {subject && <>
      <button type="button" className="gz-link gz-play-source-back" onClick={backToList}><ArrowLeft size={16} />返回播放来源</button>
      <h3 className="gz-play-source-subject gz-truncate">{subject.item.name}</h3>
      <p className="gz-meta gz-truncate">{subject.plugin.name}</p>
      {loading && <p className="gz-meta" role="status">正在读取线路与剧集…</p>}
      {!!chapters?.roads.length && <>
        <label className="gz-play-source-road">播放线路<select disabled={playing} value={road} onChange={event => setRoad(Number(event.target.value))}>{chapters.roads.map((item, index) => <option key={index} value={index}>{item.name} · {item.episodes.length} 集</option>)}</select></label>
        <div className="gz-play-source-episodes">{episodes.map((episode, index) => <button type="button" className="gz-play-source-episode" key={`${episode.url}:${index}`} disabled={playing} onClick={() => void play(index)}><Play size={16} aria-hidden="true" /><span className="gz-truncate">{episode.name}</span></button>)}</div>
      </>}
      {chapters && !loading && !chapters.roads.length && <p className="gz-meta">来源暂未提供有效线路，可返回选择其他结果。</p>}
      {playing && <p className="gz-meta" role="status">正在打开播放器…</p>}
    </>}
    </div>
  </section></div>;
}
