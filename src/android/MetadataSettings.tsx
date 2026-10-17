import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Plug, Trash2 } from "lucide-react";
import { api } from "../api";
import { invoke } from "@tauri-apps/api/core";
import type { MetadataProviderStatus } from "../types";
import { androidSession } from "./sessionCache";

const providerStatus = (provider: MetadataProviderStatus) => provider.requiresCredential
  ? (provider.configured ? "已配置" : "未配置")
  : (provider.available ? "可用" : "暂不可用");

export default function MetadataSettings() {
  const [providers, setProviders] = useState<MetadataProviderStatus[]>(() => androidSession.peek<MetadataProviderStatus[]>("provider-status") ?? []);
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(() => !androidSession.peek("provider-status"));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void androidSession.load("provider-status", () => api.metadataProviderStatuses()).then(value => { if (active) setProviders(value); })
      .catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function save(value: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api.setSetting("metadata.tmdb_read_token", value);
      setToken(""); setVisible(false);
      setMessage(value ? "TMDB 配置已保存" : "TMDB 配置已清除");
      androidSession.invalidate("provider-status");
      androidSession.invalidate("episode-artwork:");
      try { setProviders(await androidSession.load("provider-status", () => api.metadataProviderStatuses(), true)); }
      catch { setError("配置已保存，状态暂时无法更新，请稍后重新打开此页面。"); }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setMessage("");
    try { await invoke("test_tmdb_connection"); setMessage("连接成功，已保存的 TMDB Token 可以使用"); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <section className="gz-net-card">
    <div className="gz-net-head"><Plug size={16} /><h2>元数据服务</h2></div>
    <p className="gz-meta">Bangumi、TMDB、AniList 等元数据来源与匹配状态。</p>
    {error && <p className="gz-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {providers.length > 0 && <div className="gz-provider-list">
      {providers.map(provider => {
        const ok = provider.requiresCredential ? provider.configured : provider.available;
        return <div className="gz-provider-row" key={provider.key}>
          <strong>{provider.label}</strong>
          <p className={`gz-provider-status ${ok ? "is-on" : ""}`}>{providerStatus(provider)}</p>
          {provider.message && <p className="gz-meta">{provider.message}</p>}
        </div>;
      })}
    </div>}
    <form className="gz-provider-form" onSubmit={event => { event.preventDefault(); void save(token.trim()); }}>
      <label className="gz-field"><span>TMDB API Read Access Token</span>
        <div className="gz-input-action"><input autoComplete="off" type={visible ? "text" : "password"} maxLength={8192} value={token} placeholder="粘贴 TMDB Read Access Token" onChange={event => setToken(event.target.value)} /><button type="button" className="gz-iconbtn" aria-label={visible ? "隐藏 Token" : "显示 Token"} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      </label>
      <p className="gz-meta">粘贴完整的较长 Token。保存后可单独测试连接；分集页面会自动补充能够核实对应的 TMDB 剧照。</p>
      <div className="gz-net-row">
        <button className="gz-btn primary" disabled={!token.trim() || busy} type="submit"><Check size={16} />保存 Token</button>
        <button className="gz-btn" disabled={busy} type="button" onClick={() => void save("")}><Trash2 size={16} />清除 Token</button>
      </div>
      <button className="gz-btn" disabled={busy} type="button" onClick={() => void test()}>测试已保存的连接</button>
    </form>
  </section>;
}
