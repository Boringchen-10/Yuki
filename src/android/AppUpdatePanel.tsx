import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Download, RefreshCw, X } from "lucide-react";
import LoadingIndicator from "./LoadingIndicator";
import { getErrorMessage } from "../utils";

interface UpdateStatus {
  phase: string; currentVersion: string; version: string; bytes: number; total: number; error: string; canInstall: boolean;
}
const busy = (phase: string) => ["checking", "downloading", "installing"].includes(phase);
const request = (command: string) => invoke<UpdateStatus>("android_native", { command, payload: {} });
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function AppUpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const read = useCallback(() => request("appUpdateStatus").then(setStatus).catch(reason => setError(getErrorMessage(reason))), []);
  useEffect(() => {
    if (!isTauri()) return;
    void read();
    const timer = window.setInterval(() => void read(), 1000);
    return () => window.clearInterval(timer);
  }, [read]);
  useEffect(() => {
    if (!isTauri()) return;
    const focused = () => void read();
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [read]);
  const action = async (command: string) => {
    setPending(true); setError("");
    try { setStatus(await request(command)); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setPending(false); }
  };
  if (!isTauri()) return <p className="gz-meta">应用内更新可在安卓安装版中使用。</p>;
  const working = pending || !!status && busy(status.phase);
  const ready = !!status && ["ready", "permission"].includes(status.phase);
  // Refactoring UI §2.8: keep download/install primary; the official page is a
  // secondary recovery action. Reuse gz-actions, gz-btn and existing theme tokens.
  return <section className="gz-panel" aria-label="应用更新">
    <h3>应用更新</h3>
    <p className="gz-meta">当前版本 {status?.currentVersion || "…"} · 从 Yuki 官方 GitHub Release 获取新版安装包。</p>
    {status?.version && <p>发现新版本 v{status.version} · {size(status.total)}</p>}
    {status?.phase === "current" && <p role="status" className="gz-meta">暂无适合此设备的更高正式版本。本机预览可能比公开版本更新。</p>}
    {status?.phase === "checking" && <LoadingIndicator label="正在检查新版…" compact />}
    {status?.phase === "downloading" && <div role="status"><p className="gz-meta">正在下载安装包：{size(status.bytes)} / {size(status.total)}</p><progress max={status.total || 1} value={status.bytes} aria-label="安装包下载进度" style={{ width: "100%" }} /></div>}
    {status?.phase === "installing" && <LoadingIndicator label="正在验证安装包…" compact />}
    {ready && <p role="status" className="gz-meta">安装包已校验。{status.phase === "permission" ? "请允许此应用安装后返回，再点安装更新。" : "点击安装更新，按系统提示完成升级。"}</p>}
    {(error || status?.error) && <p role="alert" className="gz-error">{error || status?.error}</p>}
    <div className="gz-actions">
      <button className="gz-btn" disabled={working} onClick={() => void action("checkAppUpdate")}><RefreshCw size={16} />检查更新</button>
      {status?.version && !ready && !working && <button className="gz-btn primary" onClick={() => void action("downloadAppUpdate")}><Download size={16} />下载安装包</button>}
      {ready && <button className="gz-btn primary" disabled={working} onClick={() => void action("installAppUpdate")}>安装更新</button>}
      {working && status?.phase !== "installing" && <button className="gz-btn" onClick={() => void action("cancelAppUpdate")}><X size={16} />取消</button>}
      {(error || status?.error) && <button className="gz-btn" disabled={working} onClick={() => void action("openAppReleases")}>前往官方发布页</button>}
    </div>
    <p className="gz-meta">升级保留媒体库、来源配置、收藏与播放记录；安装包会核对包名、版本、SHA-256 和签名。首次安装更新可能需要系统授权。</p>
  </section>;
}
