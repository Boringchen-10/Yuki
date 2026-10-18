import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, RefreshCw, X } from "lucide-react";
import LoadingIndicator from "./LoadingIndicator";
import { downloadBytes } from "./downloadCenterApi";

export interface DownloadStorage { selected: string; available: boolean; wifiOnly?: boolean; locations: { id: string; label: string; path: string; freeBytes: number }[] }
export default function DownloadSettings({ onClose, onBusyChange }: { onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), revision = useRef(0), alive = useRef(false);
  const [storage, setStorage] = useState<DownloadStorage | null>(null), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [wifiOnly, setWifiOnly] = useState(false);
  async function load() {
    const token = ++revision.current; setLoading(true); setError("");
    try { const value = await invoke<DownloadStorage>("get_download_storage"); if (alive.current && revision.current === token) { setStorage(value); setSelected(value.selected); setWifiOnly(value.wifiOnly ?? false); } }
    catch (reason) { if (alive.current && revision.current === token) setError(String(reason)); }
    finally { if (alive.current && revision.current === token) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; void load(); const node = dialog.current, opener = document.activeElement as HTMLElement | null; node?.showModal();
    return () => { alive.current = false; revision.current++; node?.close(); if (opener?.isConnected) opener.focus({preventScroll:true}); };
  }, []);
  useEffect(() => { onBusyChange(saving); return () => onBusyChange(false); }, [saving, onBusyChange]);
  async function save() {
    if (saving || !storage?.locations.some(item => item.id === selected)) return;
    setSaving(true); setError("");
    try { await invoke<DownloadStorage>("set_download_storage", { id: selected, wifiOnly }); if (alive.current) onClose(); }
    catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setSaving(false); }
  }
  const choice = storage?.locations.find(item => item.id === selected);
  // Refactoring UI §2.8 / §3.6: directory is the primary decision; keep one save
  // action and group capacity/path beneath it using existing dialog/theme tokens.
  return <dialog ref={dialog} className="gz-download-settings" aria-labelledby="gz-download-settings-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header className="gz-download-heading"><h2 id="gz-download-settings-title">下载设置</h2><button type="button" className="gz-iconbtn" aria-label="关闭下载设置" disabled={saving} onClick={onClose}><X size={20} /></button></header>
    {loading ? <LoadingIndicator label="正在读取下载目录…" compact /> : storage && <>
      <label className="gz-field"><span>下载目录</span><select aria-label="下载目录" value={selected} disabled={saving} onChange={event => setSelected(event.target.value)}>
        {!storage.available && <option value={storage.selected} disabled>原目录当前不可用，请重新选择</option>}{storage.locations.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
      {choice && <div className="gz-download-directory"><Folder size={20} aria-hidden="true" /><div><strong>可用空间 {downloadBytes(choice.freeBytes)}</strong><p className="gz-meta">{choice.path}</p></div></div>}
      <label className="gz-download-wifi"><input type="checkbox" checked={wifiOnly} disabled={saving} onChange={event => setWifiOnly(event.target.checked)} /><span>仅 Wi-Fi 下载</span></label>
      <p className="gz-meta">视频、漫画、小说和文件任务共用此设置。离开 Wi-Fi 后等待连接恢复，已暂停的任务保持暂停。</p>
      <p className="gz-meta">后续下载使用所选位置，已有下载保留原位。检测到 SD 卡时可在这里选择；应用专属文件会随卸载清除。</p>
    </>}
    {error && <p className="gz-error" role="alert">{error}</p>}
    <div className="gz-actions"><button type="button" className="gz-btn" disabled={saving} onClick={onClose}>取消</button>{storage ? <button type="button" className="gz-btn primary" disabled={saving || loading || !choice} onClick={() => void save()}>{saving ? "正在保存…" : "保存下载设置"}</button> : !loading && <button type="button" className="gz-btn" onClick={() => void load()}><RefreshCw size={16} />重试</button>}</div>
  </dialog>;
}
