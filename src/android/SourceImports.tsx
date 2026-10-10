import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, X } from "lucide-react";
import { activeImport, androidApi, type SourceImportTask, type VideoSource } from "./api";
import "./sourceImports.css";

const stages: Record<string, string> = { queued: "等待整理", scanning: "扫描目录", recognizing: "识别作品", enriching: "补充资料与图片", completed: "整理完成", cancelled: "已停止", failed: "整理中断", interrupted: "运行已中断" };
export function useSourceImports(onRefresh: () => Promise<void>) {
  const [tasks, setTasks] = useState<SourceImportTask[]>([]);
  const refresh = useRef(onRefresh); refresh.current = onRefresh;
  useEffect(() => {
    let disposed = false, stop: (() => void) | undefined, lastRefresh = 0;
    const revisions = new Map<string, number>();
    const update = (task: SourceImportTask) => {
      if (disposed) return;
      setTasks(previous => [task, ...previous.filter(item => item.id !== task.id)].slice(0, 30));
      if (!document.hidden && (!activeImport(task) || Date.now() - lastRefresh >= 5000)) {
        lastRefresh = Date.now(); void refresh.current().catch(() => {});
      }
    };
    const load = () => { void androidApi.imports().then(value => { if (!disposed) setTasks(value); }).catch(() => {}); };
    void listen<{ revision: number; task: SourceImportTask }>("source-import-updated", ({ payload }) => {
      if (payload.revision <= (revisions.get(payload.task.id) ?? -1)) return;
      revisions.set(payload.task.id, payload.revision); update(payload.task);
    }).then(unlisten => { if (disposed) unlisten(); else { stop = unlisten; load(); } }).catch(load);
    const visible = () => { if (!document.hidden) { load(); void refresh.current().catch(() => {}); } };
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => { disposed = true; stop?.(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return { tasks, reload: async () => setTasks(await androidApi.imports()) };
}

export default function SourceImports({ tasks, sources, showHistory = false, onChange }: { tasks: SourceImportTask[]; sources: VideoSource[]; showHistory?: boolean; onChange: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const active = tasks.filter(activeImport), interrupted = tasks.filter(task => ["interrupted", "failed"].includes(task.stage));
  async function action(operation: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await operation(); await onChange(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
  if (!tasks.length) return null;
  if (!active.length && !interrupted.length && !showHistory) return null;
  const latest = active[0] ?? interrupted[0] ?? tasks[0];
  if (!latest) return null;
  return <>
    <button className={`gz-import-status${active.length ? " is-active" : ""}`} onClick={() => dialog.current?.showModal()} aria-label="查看后台整理任务">
      <RefreshCw size={16} /><span>{stages[latest.stage]}{active.length > 1 ? ` · ${active.length} 项` : latest.total ? ` · ${latest.done}/${latest.total}` : ""}</span>
    </button>
    <dialog ref={dialog} data-source-import-dialog className="gz-import-dialog">
      <div className="gz-row"><h2>后台整理</h2><button className="gz-iconbtn" aria-label="关闭后台整理" onClick={() => dialog.current?.close()}><X /></button></div>
      <p className="gz-meta">可以离开此页或切换应用。首次添加自动扫描；之后新增文件请在来源中手动更新。无法可靠识别的目录保留待整理。</p>
      {error && <p className="gz-error" role="alert">{error}</p>}
      {tasks.map(task => <section className="gz-panel" key={task.id}>
        <strong>{task.sourceIds.map(id => sources.find(source => source.id === id)?.label ?? "视频来源").join("、")} · {stages[task.stage]}</strong>
        {task.currentDirectory && <p className="gz-file-name">当前文件夹：{task.currentDirectory}</p>}
        {task.currentTitle && <p className="gz-meta">{task.currentTitle}</p>}
        <progress aria-label="后台整理进度" {...(task.stage !== "scanning" && task.total ? { max: task.total, value: task.done } : {})} />
        <p className="gz-meta">{task.stage === "scanning" ? "正在枚举目录，扫描完成后开始识别。" : task.stage === "queued" && !task.total ? "正在准备整理任务…" : `已处理 ${task.done}/${task.total} · 已归档 ${task.matched} · 待核对 ${task.pending} · 失败 ${task.errors}`}</p>
        {task.message && <p className="gz-meta">{task.message}</p>}
        {activeImport(task) ? <button className="gz-btn" disabled={busy} onClick={() => void action(() => androidApi.cancelImport(task.id))}>处理完本项后停止</button>
          : ["cancelled", "failed", "interrupted"].includes(task.stage) && <button className="gz-btn" disabled={busy} onClick={() => void action(() => androidApi.resumeImport(task.id))}>继续整理</button>}
      </section>)}
    </dialog>
  </>;
}
