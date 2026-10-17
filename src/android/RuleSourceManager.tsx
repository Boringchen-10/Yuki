import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ClipboardPaste, Compass, FileUp, GripVertical, MoreHorizontal, Package, Pencil, PenLine, Plus, RefreshCw, Search, Share2, Trash2, X } from "lucide-react";
import { rulesApi, type RuleCatalogItem, type RulePlugin } from "./rulesApi";
import RuleBrowser from "./RuleBrowser";
import { usePreferences } from "../store";
import "./rules.css";

function domainOf(origin: string | null): string {
  if (!origin) return "";
  try { return new URL(origin).host; } catch { return origin.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? ""; }
}

export default function RuleSourceManager({ onChanged, registerBack, onBusyChange, onboarding = false, onCountChange }: { onChanged: () => Promise<void>; registerBack: (handler: (() => boolean) | null) => void; onBusyChange?: (busy: boolean) => void; onboarding?: boolean; onCountChange?: (count: number) => void }) {
  const [plugins, setPlugins] = useState<RulePlugin[]>([]), [catalog, setCatalog] = useState<RuleCatalogItem[] | null>(null);
  const [filter, setFilter] = useState(""), [catalogFilter, setCatalogFilter] = useState(""), [catalogView, setCatalogView] = useState<"all" | "installed" | "updatable">("all"), [view, setView] = useState<"all" | "updatable">("all");
  const [definition, setDefinition] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [browser, setBrowser] = useState<RulePlugin | null>(null), [removing, setRemoving] = useState<RulePlugin | null>(null);
  const [editor, setEditor] = useState<{ plugin: RulePlugin | null } | null>(null), [menu, setMenu] = useState<string | null>(null), [dragging, setDragging] = useState<string | null>(null), [addOpen, setAddOpen] = useState(false), [catalogOpen, setCatalogOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), editorDialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const prevTops = useRef(new Map<string, number>());
  const dragState = useRef<{ id: string; grabOffset: number; translate: number; pointerY: number; slots: { top: number; bottom: number; id: string }[] } | null>(null);
  const ruleOrder = usePreferences(state => state.ruleOrder), setRuleOrder = usePreferences(state => state.setRuleOrder);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { onCountChange?.(plugins.length); }, [plugins.length, onCountChange]);
  useEffect(() => { let active = true; void rulesApi.plugins().then(items => { if (active) setPlugins(items); }).catch(reason => { if (active) setError(String(reason)); }); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; void rulesApi.catalog(false).then(result => { if (active) setCatalog(result.items); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => { if (browser) dialog.current?.showModal(); }, [browser]);
  useEffect(() => { if (editor) editorDialog.current?.showModal(); }, [editor]);
  const ordered = useMemo(() => {
    if (!ruleOrder.length) return plugins;
    const rank = new Map(ruleOrder.map((id, index) => [id, index]));
    return [...plugins].sort((a, b) => (rank.get(a.id) ?? ruleOrder.length) - (rank.get(b.id) ?? ruleOrder.length));
  }, [plugins, ruleOrder]);
  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    rowRefs.current.forEach((el, id) => tops.set(id, el.offsetTop));
    rowRefs.current.forEach((el, id) => {
      if (dragState.current?.id === id) return;
      const before = prevTops.current.get(id), after = tops.get(id);
      if (before == null || after == null || Math.abs(before - after) < 0.5) return;
      el.animate([{ transform: `translateY(${before - after}px)` }, { transform: "translateY(0px)" }], { duration: 260, easing: "cubic-bezier(.22,.61,.36,1)" });
    });
    prevTops.current = tops;
  });
  useLayoutEffect(() => {
    const state = dragState.current, el = state && rowRefs.current.get(state.id);
    if (!state || !el) return;
    state.translate = state.pointerY - state.grabOffset - (el.getBoundingClientRect().top - state.translate);
    el.style.transform = `translateY(${state.translate}px)`;
    el.style.zIndex = "6";
  }, [dragging, ordered]);
  const updatable = (plugin: RulePlugin) => { const item = catalog?.find(entry => entry.name.toLowerCase() === plugin.name.toLowerCase()); return !!item && item.version !== plugin.version; };
  const updatableCount = ordered.filter(updatable).length;
  const needle = filter.trim().toLowerCase();
  const visible = ordered.filter(plugin => (view === "all" || updatable(plugin)) && (!needle || plugin.name.toLowerCase().includes(needle) || domainOf(plugin.origin).toLowerCase().includes(needle)));
  const installedOf = (item: RuleCatalogItem) => plugins.find(plugin => plugin.name.toLowerCase() === item.name.toLowerCase());
  const catalogNeedle = catalogFilter.trim().toLowerCase();
  const catalogRows = (catalog ?? []).filter(item => {
    const installed = installedOf(item);
    if (catalogNeedle && !item.name.toLowerCase().includes(catalogNeedle)) return false;
    if (catalogView === "installed") return !!installed;
    if (catalogView === "updatable") return !!installed && installed.version !== item.version;
    return true;
  });
  const installedCount = (catalog ?? []).filter(item => !!installedOf(item)).length;
  const catalogUpdatableCount = (catalog ?? []).filter(item => { const installed = installedOf(item); return !!installed && installed.version !== item.version; }).length;
  useEffect(() => {
    registerBack(() => { if (addOpen) { setAddOpen(false); return true; } if (catalogOpen) { setCatalogOpen(false); return true; } return false; });
    return () => registerBack(null);
  }, [addOpen, catalogOpen, registerBack]);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const state = dragState.current, el = state && rowRefs.current.get(state.id);
      if (state && el) {
        state.pointerY = event.clientY;
        state.translate = event.clientY - state.grabOffset - (el.getBoundingClientRect().top - state.translate);
        el.style.transform = `translateY(${state.translate}px)`;
        el.style.zIndex = "6";
      }
      if (!el) return;
      const slots = state!.slots;
      if (!slots.length) return;
      const center = el.getBoundingClientRect().top + el.offsetHeight / 2;
      const index = Math.min(slots.length - 1, Math.max(0, slots.filter(entry => center >= entry.top).length - 1));
      const visibleIds = visible.map(plugin => plugin.id);
      const from = visibleIds.indexOf(dragging);
      if (from < 0 || from === index) return;
      visibleIds.splice(from, 1);
      visibleIds.splice(index, 0, dragging);
      const visibleSet = new Set(visibleIds), positions: number[] = [];
      ordered.forEach((plugin, position) => { if (visibleSet.has(plugin.id)) positions.push(position); });
      const next = ordered.map(plugin => plugin.id);
      positions.forEach((position, order) => { next[position] = visibleIds[order]!; });
      setRuleOrder(next);
    };
    const end = () => {
      const state = dragState.current, el = state && rowRefs.current.get(state.id);
      if (el) { el.style.transform = ""; el.style.zIndex = ""; }
      dragState.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, [dragging, ordered, visible, setRuleOrder]);
  const editorPlugin = editor?.plugin ? plugins.find(plugin => plugin.id === editor.plugin!.id) ?? editor.plugin : null;
  async function run(operation: () => Promise<unknown>) { setBusy(true); setError(""); setMessage(""); try { await operation(); setPlugins(await rulesApi.plugins()); await onChanged(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } }
  async function load(fresh: boolean) { await run(async () => { const result = await rulesApi.catalog(fresh); setCatalog(result.items); if (result.warning) setMessage(result.warning); }); }
  async function checkUpdate(plugin: RulePlugin) { const item = catalog?.find(entry => entry.name.toLowerCase() === plugin.name.toLowerCase()); if (plugin.origin) await run(() => rulesApi.update(plugin.id)); else if (item) await run(() => rulesApi.install(item.name)); else setMessage("该规则没有更新来源，可重新导入 JSON。"); }
  async function updateAll() { await run(async () => { for (const plugin of ordered.filter(updatable)) { const item = catalog!.find(entry => entry.name.toLowerCase() === plugin.name.toLowerCase())!; if (plugin.origin) await rulesApi.update(plugin.id); else await rulesApi.install(item.name); } }); }
  async function share(plugin: RulePlugin) { try { const text = plugin.origin || JSON.stringify(await rulesApi.definition(plugin.id), null, 2); if (!navigator.clipboard?.writeText) throw new Error("clipboard"); await navigator.clipboard.writeText(text); setMessage(`已复制「${plugin.name}」的规则内容`); } catch { setError("当前环境无法复制规则内容"); } }
  async function edit(plugin: RulePlugin) { try { setDefinition(JSON.stringify(await rulesApi.definition(plugin.id), null, 2)); setEditor({ plugin }); } catch (reason) { setError(String(reason)); } }
  async function saveEditor() { const text = definition.trim(); if (!text) return; await run(async () => { if (/^https?:\/\//i.test(text)) await rulesApi.importUrl(text); else await rulesApi.import(JSON.parse(text), editor?.plugin?.origin ?? null); setEditor(null); setMessage("规则已保存"); }); }
  function openCatalog() { setCatalogOpen(true); if (!catalog) void load(false); }
  async function importClipboard() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (!navigator.clipboard?.readText) throw new Error("clipboard");
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error("empty");
      if (/^https?:\/\//i.test(text)) await rulesApi.importUrl(text); else await rulesApi.import(JSON.parse(text));
      setPlugins(await rulesApi.plugins()); await onChanged(); setAddOpen(false); setMessage("规则已从剪贴板导入");
    } catch (reason) { setError(reason instanceof SyntaxError ? "剪贴板内容不是有效的规则 JSON。" : "无法读取剪贴板，请改用文件导入或新建规则。"); }
    finally { setBusy(false); }
  }
  async function importFile(file: File) {
    setBusy(true); setError(""); setMessage("");
    try {
      const text = (await file.text()).trim();
      if (/^https?:\/\//i.test(text)) await rulesApi.importUrl(text); else await rulesApi.import(JSON.parse(text));
      setPlugins(await rulesApi.plugins()); await onChanged(); setAddOpen(false); setMessage(`已从「${file.name}」导入规则`);
    } catch (reason) { setError(reason instanceof SyntaxError ? "文件内容不是有效的规则 JSON。" : String(reason)); }
    finally { setBusy(false); }
  }
  function move(plugin: RulePlugin, delta: number) { const ids = ordered.map(entry => entry.id), from = ids.indexOf(plugin.id), to = from + delta; if (from < 0 || to < 0 || to >= ids.length) return; ids.splice(to, 0, ...ids.splice(from, 1)); setRuleOrder(ids); }
  return <>
    {onboarding ? <section className="gz-onboarding-sources" aria-label="添加来源方式">
      {/* Refactoring UI §2.8 / §8.4: lead with a source choice, hide empty filters. */}
      <button type="button" className={`gz-onboarding-source${plugins.length ? "" : " is-recommended"}`} aria-label="规则仓库" disabled={busy} onClick={() => openCatalog()}><span className="gz-onboarding-source-icon"><Compass size={24} aria-hidden="true" /></span><span><strong>从规则仓库添加</strong><span>浏览社区规则，选择需要的来源</span></span><ChevronRight size={20} aria-hidden="true" /></button>
      <button type="button" className="gz-onboarding-source" aria-label="添加规则" disabled={busy} onClick={() => setAddOpen(true)}><span className="gz-onboarding-source-icon"><FileUp size={24} aria-hidden="true" /></span><span><strong>导入已有规则</strong><span>使用链接、JSON、文件或剪贴板</span></span><ChevronRight size={20} aria-hidden="true" /></button>
      {!!plugins.length && <p className="gz-onboarding-installed" role="status"><Check size={18} aria-hidden="true" />已添加 {plugins.length} 条规则，可以开始使用</p>}
    </section> : <section className="gz-rule-hero">
      <div className="gz-rule-hero-head"><h2>我的规则</h2><span className="gz-rule-hero-badge" aria-hidden="true"><Package size={20} /></span></div>
      <p className="gz-rule-hero-desc">管理你的番剧来源。拖动调整搜索顺序，点按规则进行编辑。</p>
      <div className="gz-rule-hero-actions">
        <button type="button" className="gz-rule-hero-add" onClick={() => setAddOpen(true)}><Plus size={16} />添加规则</button>
        <button type="button" className="gz-rule-hero-catalog" disabled={busy} onClick={() => openCatalog()}><Package size={16} />规则仓库</button>
      </div>
    </section>}
    {!catalogOpen && error && <p className="gz-error" role="alert">{error}</p>}{!catalogOpen && message && <p className="gz-meta" role="status">{message}</p>}
    {(!onboarding || !!plugins.length) && <><label className="gz-rule-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="搜索名称或站点" placeholder="搜索名称或站点" value={filter} onChange={event => setFilter(event.target.value)} /></label>
    <div className="gz-rule-chips">
      <button type="button" className={`gz-rule-chip${view === "all" ? " active" : ""}`} onClick={() => setView("all")}>全部 {ordered.length}</button>
      <button type="button" className={`gz-rule-chip${view === "updatable" ? " active" : ""}`} onClick={() => setView("updatable")}>可更新 {updatableCount}</button>
      <button type="button" className="gz-rule-chip gz-rule-chip-action" disabled={busy || !updatableCount} onClick={() => void updateAll()}><RefreshCw size={15} aria-hidden="true" />更新全部</button>
    </div></>}
    {visible.map(plugin => <article ref={node => { if (node) rowRefs.current.set(plugin.id, node); else rowRefs.current.delete(plugin.id); }} className={`gz-rule-card${plugin.enabled ? "" : " is-disabled"}${dragging === plugin.id ? " is-dragging" : ""}`} key={plugin.id} data-rule-row={plugin.id}>
      <button type="button" className="gz-rule-card-icon" aria-hidden="true" onClick={() => void edit(plugin)}><Package size={20} /></button>
      <button type="button" className="gz-rule-card-main" onClick={() => void edit(plugin)}>
        <strong>{plugin.name}</strong>
        <span className="gz-meta">{domainOf(plugin.origin) || "本地导入"}</span>
        <span className="gz-rule-version">{plugin.version}{plugin.enabled ? "" : " · 已停用"}</span>
      </button>
      <button type="button" className="gz-iconbtn gz-rule-more" aria-label={`${plugin.name} 更多操作`} aria-haspopup="menu" aria-expanded={menu === plugin.id} onClick={() => setMenu(menu === plugin.id ? null : plugin.id)}><MoreHorizontal size={20} /></button>
      <button type="button" className="gz-iconbtn gz-rule-grip" aria-label={`拖动排序 ${plugin.name}`} onPointerDown={event => { event.preventDefault(); const el = rowRefs.current.get(plugin.id); if (!el) return; const rect = el.getBoundingClientRect(); const slots = Array.from(document.querySelectorAll<HTMLElement>("[data-rule-row]")).map(row => { const bounds = row.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom, id: row.dataset.ruleRow ?? "" }; }).sort((a, b) => a.top - b.top); dragState.current = { id: plugin.id, grabOffset: event.clientY - rect.top, translate: 0, pointerY: event.clientY, slots }; setDragging(plugin.id); }}><GripVertical size={18} /></button>
      {menu === plugin.id && <div className="gz-rule-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenu(null); void edit(plugin); }}><Pencil size={16} />编辑规则</button>
        <button type="button" role="menuitem" disabled={busy || !plugin.enabled} onClick={() => { setMenu(null); setBrowser(plugin); }}><Search size={16} />测试规则</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(null); void checkUpdate(plugin); }}><RefreshCw size={16} />检查更新</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(null); void share(plugin); }}><Share2 size={16} />分享规则</button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(null); void run(() => rulesApi.enabled(plugin.id, !plugin.enabled)); }}>{plugin.enabled ? <ArrowDown size={16} /> : <ArrowUp size={16} />}{plugin.enabled ? "停用规则" : "启用规则"}</button>
        <div className="gz-rule-menu-sep" role="separator" />
        <button type="button" role="menuitem" disabled={ordered[0]?.id === plugin.id} onClick={() => { setMenu(null); move(plugin, -1); }}><ArrowUp size={16} />上移</button>
        <button type="button" role="menuitem" disabled={ordered[ordered.length - 1]?.id === plugin.id} onClick={() => { setMenu(null); move(plugin, 1); }}><ArrowDown size={16} />下移</button>
        <div className="gz-rule-menu-sep" role="separator" />
        <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => { setMenu(null); setRemoving(plugin); }}><Trash2 size={16} />删除规则</button>
      </div>}
    </article>)}
    {menu && <button type="button" className="gz-rule-menu-backdrop" aria-label="关闭菜单" onClick={() => setMenu(null)} />}
    {!visible.length && (!onboarding || !!plugins.length) && <p className="gz-meta">{ordered.length ? "没有匹配的规则。" : "尚未安装规则，从规则仓库安装或导入 JSON。"}</p>}
    {catalogOpen && <section className="gz-catalog-page" role="dialog" aria-modal="true" aria-label="规则仓库">
      <header className="gz-catalog-head">
        <button type="button" className="gz-iconbtn" aria-label="返回" onClick={() => setCatalogOpen(false)}><ChevronLeft size={22} /></button>
        <h2>规则仓库</h2>
        <button type="button" className="gz-iconbtn" aria-label="刷新规则仓库" disabled={busy} onClick={() => void load(true)}><RefreshCw size={20} /></button>
      </header>
      {error && <p className="gz-error" role="alert">{error}</p>}
      {message && <p className="gz-meta" role="status">{message}</p>}
      <p className="gz-catalog-desc">发现并安装社区维护的番剧规则，安装后可随时回到这里更新。</p>
      <label className="gz-rule-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="搜索规则仓库" placeholder="搜索规则名称" value={catalogFilter} onChange={event => setCatalogFilter(event.target.value)} /></label>
      <div className="gz-rule-chips">
        <button type="button" className={`gz-rule-chip${catalogView === "all" ? " active" : ""}`} onClick={() => setCatalogView("all")}>全部 {catalog?.length ?? 0}</button>
        <button type="button" className={`gz-rule-chip${catalogView === "installed" ? " active" : ""}`} onClick={() => setCatalogView("installed")}>已安装 {installedCount}</button>
        <button type="button" className={`gz-rule-chip${catalogView === "updatable" ? " active" : ""}`} onClick={() => setCatalogView("updatable")}>可更新 {catalogUpdatableCount}</button>
      </div>
      {!catalog && <p className="gz-meta">{busy ? "正在加载规则仓库…" : "规则仓库暂时不可用，请稍后重试。"}</p>}
      {catalog && <div className="gz-rule-catalog">{catalogRows.map(item => { const installed = installedOf(item); return <article className="gz-rule-catalog-row" key={item.name}><span className="gz-rule-catalog-icon" aria-hidden="true"><Package size={18} /></span><span className="gz-row-main"><strong>{item.name}</strong><span className="gz-meta">v{item.version}{item.author ? ` · ${item.author}` : ""}{item.antiCrawlerEnabled ? " · 可能需要网页验证" : ""}</span></span><button className="gz-btn" disabled={busy} onClick={() => void run(() => rulesApi.install(item.name))}>{installed ? installed.version === item.version ? "重新获取" : "更新" : "安装"}</button></article>; })}</div>}
      {catalog && !catalogRows.length && <p className="gz-meta">没有匹配的规则。</p>}
    </section>}
    {addOpen && <div className="gz-add-scrim" role="presentation" onClick={() => setAddOpen(false)}>
      <div className="gz-add-sheet" role="dialog" aria-modal="true" aria-label="添加规则" onClick={event => event.stopPropagation()}>
        <span className="gz-add-badge" aria-hidden="true"><Plus size={22} /></span>
        <h2 className="gz-add-title">添加规则</h2>
        <p className="gz-add-sub">选择一种方式，添加新的番剧来源。</p>
        <div className="gz-add-options">
          <button type="button" className="gz-add-option" onClick={() => { setAddOpen(false); openCatalog(); }}>
            <span className="gz-add-option-icon" aria-hidden="true"><Compass size={20} /></span>
            <span className="gz-add-option-text"><strong>浏览规则仓库</strong><span>发现并安装社区规则</span></span>
            <ChevronRight size={18} className="gz-add-option-arrow" aria-hidden="true" />
          </button>
          <button type="button" className="gz-add-option" disabled={busy} onClick={() => void importClipboard()}>
            <span className="gz-add-option-icon" aria-hidden="true"><ClipboardPaste size={20} /></span>
            <span className="gz-add-option-text"><strong>从剪贴板导入</strong><span>粘贴规则链接或 JSON</span></span>
            <ChevronRight size={18} className="gz-add-option-arrow" aria-hidden="true" />
          </button>
          <button type="button" className="gz-add-option" disabled={busy} onClick={() => fileInput.current?.click()}>
            <span className="gz-add-option-icon" aria-hidden="true"><FileUp size={20} /></span>
            <span className="gz-add-option-text"><strong>从文件导入</strong><span>读取本地 JSON 规则文件</span></span>
            <ChevronRight size={18} className="gz-add-option-arrow" aria-hidden="true" />
          </button>
          <button type="button" className="gz-add-option" onClick={() => { setAddOpen(false); setDefinition(""); setEditor({ plugin: null }); }}>
            <span className="gz-add-option-icon" aria-hidden="true"><PenLine size={20} /></span>
            <span className="gz-add-option-text"><strong>新建规则</strong><span>从模板开始编写</span></span>
            <ChevronRight size={18} className="gz-add-option-arrow" aria-hidden="true" />
          </button>
        </div>
        <div className="gz-add-footer"><button type="button" className="gz-add-cancel" onClick={() => setAddOpen(false)}>取消</button></div>
      </div>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
    </div>}
    {removing && <div className="gz-panel gz-rule-remove"><strong>移除 {removing.name}？</strong><p className="gz-meta">作品和观看记录保留，此规则的播放来源将不可用。</p><div className="gz-actions"><button className="gz-btn" disabled={busy} onClick={() => setRemoving(null)}>取消</button><button className="gz-btn" disabled={busy} onClick={() => void run(async () => { await rulesApi.enabled(removing.id, false, true); setRemoving(null); })}>确认移除规则</button></div></div>}
    {browser && <dialog ref={dialog} data-rule-dialog className="gz-rule-dialog" onClose={() => setBrowser(null)}><div className="gz-section-head"><h2>测试 {browser.name}</h2><button className="gz-iconbtn" aria-label="关闭规则测试" onClick={() => dialog.current?.close()}><X /></button></div><RuleBrowser pluginId={browser.id} registerBack={registerBack} /></dialog>}
    {editor && <dialog ref={editorDialog} data-rule-dialog className="gz-rule-dialog" onClose={() => setEditor(null)}>
      <div className="gz-section-head"><h2>{editor.plugin ? `编辑 ${editor.plugin.name}` : "新建规则"}</h2><button className="gz-iconbtn" aria-label="关闭规则编辑" onClick={() => editorDialog.current?.close()}><X /></button></div>
      {editorPlugin && <button type="button" role="switch" aria-checked={editorPlugin.enabled} className="gz-toggle-row" disabled={busy} onClick={() => void run(() => rulesApi.enabled(editorPlugin.id, !editorPlugin.enabled))}><span className="gz-row-main"><strong>{editorPlugin.enabled ? "已启用" : "已停用"}</strong><span className="gz-meta">点击切换该规则的启用状态。</span></span><span className={`gz-switch ${editorPlugin.enabled ? "active" : ""}`} aria-hidden="true"><span /></span></button>}
      <label>规则 JSON 或规则网址<textarea rows={10} maxLength={262144} value={definition} onChange={event => setDefinition(event.target.value)} placeholder="粘贴 Kazumi 规则 JSON，或单条规则的 JSON 网址" /></label>
      <div className="gz-actions"><button type="button" className="gz-btn primary" disabled={busy || !definition.trim()} onClick={() => void saveEditor()}><Check size={16} />保存规则</button></div>
    </dialog>}
  </>;
}
