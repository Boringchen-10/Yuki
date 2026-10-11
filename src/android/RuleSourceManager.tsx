import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { rulesApi, type RuleCatalogItem, type RulePlugin } from "./rulesApi";
import RuleBrowser from "./RuleBrowser";
import "./rules.css";

export default function RuleSourceManager({ onChanged, registerBack }: { onChanged: () => Promise<void>; registerBack: (handler: (() => boolean) | null) => void }) {
  const [plugins, setPlugins] = useState<RulePlugin[]>([]), [catalog, setCatalog] = useState<RuleCatalogItem[] | null>(null), [filter, setFilter] = useState("");
  const [definition, setDefinition] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [browser, setBrowser] = useState<RulePlugin | null>(null), [removing, setRemoving] = useState<RulePlugin | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const importer = useRef<HTMLDetailsElement>(null);
  useEffect(() => { let active = true; void rulesApi.plugins().then(items => { if (active) setPlugins(items); }).catch(reason => { if (active) setError(String(reason)); }); return () => { active = false; }; }, []);
  useEffect(() => { if (browser) dialog.current?.showModal(); }, [browser]);
  async function run(operation: () => Promise<unknown>) { setBusy(true); setError(""); setMessage(""); try { await operation(); setPlugins(await rulesApi.plugins()); await onChanged(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } }
  async function load(fresh: boolean) { await run(async () => { const result = await rulesApi.catalog(fresh); setCatalog(result.items); if (result.warning) setMessage(result.warning); }); }
  return <>
    <p className="gz-meta">从 KazumiRules 安装规则，或导入规则 JSON / 网址。安装后可测试搜索，在作品详情关联规则剧集并保存观看进度。</p>
    {error && <p className="gz-error" role="alert">{error}</p>}{message && <p className="gz-meta" role="status">{message}</p>}
    <div className="gz-actions"><button className="gz-btn" disabled={busy} onClick={() => void load(!!catalog)}><RefreshCw size={16} />{catalog ? "刷新规则仓库" : "浏览规则仓库"}</button></div>
    {plugins.map(plugin => <article className="gz-panel gz-rule-plugin" key={plugin.id}><strong>{plugin.name} · {plugin.version}</strong><p className="gz-meta">{plugin.enabled ? "已启用" : "已停用"}</p><div className="gz-actions"><button className="gz-btn" disabled={busy || !plugin.enabled} onClick={() => setBrowser(plugin)}>测试搜索</button><button className="gz-btn" disabled={busy} onClick={() => void run(() => rulesApi.enabled(plugin.id, !plugin.enabled))}>{plugin.enabled ? "停用" : "启用"}</button>{plugin.origin && <button className="gz-btn" disabled={busy} onClick={() => void run(() => rulesApi.update(plugin.id))}>更新规则</button>}<button className="gz-link" disabled={busy} onClick={() => void run(async () => { setDefinition(JSON.stringify(await rulesApi.definition(plugin.id), null, 2)); if (importer.current) { importer.current.open = true; importer.current.scrollIntoView({ block: "start" }); } })}>编辑 JSON</button><button className="gz-link" disabled={busy} onClick={() => setRemoving(plugin)}>移除规则</button></div></article>)}
    {!plugins.length && <p className="gz-meta">尚未安装规则。</p>}
    {removing && <div className="gz-panel"><strong>移除 {removing.name}？</strong><p className="gz-meta">作品和观看记录保留，此规则的播放来源将不可用。</p><div className="gz-actions"><button className="gz-btn" disabled={busy} onClick={() => setRemoving(null)}>取消</button><button className="gz-btn" disabled={busy} onClick={() => void run(async () => { await rulesApi.enabled(removing.id, false, true); setRemoving(null); })}>确认移除规则</button></div></div>}
    {catalog && <><label>筛选规则<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="规则名称" /></label><div className="gz-rule-catalog">{catalog.filter(item => item.name.toLowerCase().includes(filter.toLowerCase())).map(item => { const installed = plugins.find(plugin => plugin.name.toLowerCase() === item.name.toLowerCase()); return <article className="gz-rule-catalog-row" key={item.name}><span className="gz-row-main"><strong>{item.name}</strong><span className="gz-meta">{item.version}{item.antiCrawlerEnabled ? " · 可能需要网页验证" : ""}</span></span><button className="gz-btn" disabled={busy} onClick={() => void run(() => rulesApi.install(item.name))}>{installed ? installed.version === item.version ? "重新获取" : "更新" : "安装"}</button></article>; })}</div></>}
    <details ref={importer} className="gz-rule-import"><summary>导入规则</summary><form onSubmit={event => { event.preventDefault(); void run(async () => { const text = definition.trim(); if (/^https?:\/\//i.test(text)) await rulesApi.importUrl(text); else await rulesApi.import(JSON.parse(text)); setDefinition(""); setMessage("规则已保存"); }); }}><label>规则 JSON 或规则网址<textarea rows={6} maxLength={262144} value={definition} onChange={event => setDefinition(event.target.value)} placeholder="粘贴 Kazumi 规则 JSON，或单条规则的 JSON 网址" /></label><button className="gz-btn primary" disabled={busy || !definition.trim()}><Plus size={16} />导入规则</button></form></details>
    {browser && <dialog ref={dialog} data-rule-dialog className="gz-rule-dialog" onClose={() => setBrowser(null)}><div className="gz-section-head"><h2>测试 {browser.name}</h2><button className="gz-iconbtn" aria-label="关闭规则测试" onClick={() => dialog.current?.close()}><X /></button></div><RuleBrowser pluginId={browser.id} registerBack={registerBack} /></dialog>}
  </>;
}
