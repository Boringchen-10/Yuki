import { useEffect, useRef, useState } from "react";
import { ChevronDown, Globe, LoaderCircle, Zap } from "lucide-react";
import { RULES_NETWORK_CHANGED, rulesNetworkApi, type RulesNetwork, type RulesNetworkMode, type RulesNetworkProbe } from "./rulesNetwork";
import "./rulesNetwork.css";

const label = (mode: RulesNetworkMode) => mode === "direct" ? "官方直连" : "镜像优先";
export default function RulesNetworkSettings({ compact = false, disabled = false, onBusyChange }: { compact?: boolean; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [config, setConfig] = useState<RulesNetwork | null>(null), [action, setAction] = useState<"" | "load" | "save" | "test">("load");
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [probes, setProbes] = useState<RulesNetworkProbe[]>([]);
  const mounted = useRef(false);
  const working = action === "save" || action === "test";
  async function load() {
    setAction("load"); setError("");
    try { const value = await rulesNetworkApi.get(); if (mounted.current) setConfig(value); }
    catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { if (mounted.current) setAction(""); }
  }
  useEffect(() => {
    mounted.current = true; void load();
    const changed = (event: Event) => { const next = (event as CustomEvent<RulesNetwork>).detail; if (next) { setConfig(next); setProbes([]); setMessage(""); } };
    window.addEventListener(RULES_NETWORK_CHANGED, changed);
    return () => { mounted.current = false; window.removeEventListener(RULES_NETWORK_CHANGED, changed); };
  }, []);
  useEffect(() => { onBusyChange?.(working); return () => onBusyChange?.(false); }, [working, onBusyChange]);
  async function save(mode: RulesNetworkMode) {
    if (!config || mode === config.mode) return;
    setAction("save"); setError(""); setMessage(""); setProbes([]);
    try {
      const next = await rulesNetworkApi.save({ mode });
      if (!mounted.current) return;
      setConfig(next); window.dispatchEvent(new CustomEvent(RULES_NETWORK_CHANGED, { detail: next })); setMessage(`已保存：${label(next.mode)}`);
    } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { if (mounted.current) setAction(""); }
  }
  async function probe() {
    setAction("test"); setError(""); setMessage(""); setProbes([]);
    try { const value = await rulesNetworkApi.probe(); if (mounted.current) setProbes(value); }
    catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { if (mounted.current) setAction(""); }
  }
  // Refactoring UI §2.8 / §3.6: connection setup is secondary to adding a source;
  // reuse existing network-card tokens, with a disclosure in the rule flow.
  return <section className="gz-net-card gz-rule-network" aria-label="规则仓库连接" aria-busy={working}>
    <details open={!compact}>
      <summary className="gz-rule-network-summary"><Globe size={18} aria-hidden="true" /><strong>规则仓库连接</strong><span>{action === "load" ? "读取中…" : config ? label(config.mode) : "读取失败"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="gz-rule-network-body">
        <p className="gz-meta">镜像优先通过 GitCode 获取规则，失败时尝试官方。对目录、安装与更新生效，自定义链接仍使用原地址。</p>
        <label className="gz-field"><span>规则连接方式</span><select aria-label="规则连接方式" value={config?.mode ?? "auto"} disabled={disabled || !!action || !config} onChange={event => void save(event.target.value as RulesNetworkMode)}><option value="auto">镜像优先（推荐）</option><option value="direct">官方直连</option></select></label>
        <div className="gz-net-row"><button type="button" className="gz-btn" disabled={disabled || !!action || !config} onClick={() => void probe()}>{working ? <LoaderCircle className="gz-spin" size={16} /> : <Zap size={16} />}测试规则连接</button>{action === "load" ? <span className="gz-meta" role="status">正在读取连接方式…</span> : <span className="gz-meta">选择后自动保存到本机</span>}</div>
        {error && <p className="gz-error" role="alert">{error}{!config && <button type="button" className="gz-link" onClick={() => void load()}>重试</button>}</p>}
        {message && <p className="gz-meta" role="status">{message}</p>}
        {!!probes.length && <div className="gz-probe-list" role="status">{probes.map(item => <p key={item.source} className={item.error ? "gz-error" : "gz-meta"}>{item.source === "mirror" ? "GitCode 镜像" : "官方仓库"}：{item.error ?? `${item.milliseconds} ms · 可用`}</p>)}</div>}
      </div>
    </details>
  </section>;
}
