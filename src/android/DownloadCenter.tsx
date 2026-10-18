import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Download, FileDown, Film, HardDrive, Images, Pause, Play, RefreshCw, Settings, Trash2, X } from "lucide-react";
import DownloadSettings from "./DownloadSettings";
import LoadingIndicator from "./LoadingIndicator";
import { DownloadRateMeter, downloadRateLabel } from "./downloadRate";
import { activeDownload, downloadBytes, downloadCenterApi, downloadErrorLabel, downloadProgress, mergeDownloadTasks, type DownloadAction, type DownloadJob, type DownloadKind, type DownloadReadTarget, type DownloadTask, type VideoDownload } from "./downloadCenterApi";
import "./downloadCenter.css";

const kindLabels: Record<DownloadKind, string> = { video: "视频", comic: "漫画", novel: "小说", file: "文件" };
const kindIcons = { video: Film, comic: Images, novel: BookOpen, file: FileDown };
const stateLabels = { queued: "等待下载", downloading: "正在下载", paused: "已暂停", interrupted: "已中断", failed: "下载失败", completed: "已完成", removing: "正在清除" };
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function downloadDetail(task: DownloadTask): string {
  const bytes = task.totalBytes != null && task.totalBytes > 0 ? `${downloadBytes(task.bytesDownloaded)} / ${downloadBytes(task.totalBytes)}` : downloadBytes(task.bytesDownloaded);
  const unit = task.kind === "comic" ? "页" : task.kind === "novel" ? "项资源" : "个文件";
  if (task.totalUnits != null && task.totalUnits > 0 && task.completedUnits != null) return `${bytes} · ${task.completedUnits} / ${task.totalUnits} ${unit}`;
  return bytes;
}

type Props = {
  onReadBook: (target: DownloadReadTarget) => void | Promise<void>;
  onOpenWork: (workId: string) => void;
  onError?: (reason: unknown) => void;
  onToast?: (message: string) => void;
  registerBack?: (handler: (() => boolean) | null) => void;
};

export default function DownloadCenter({ onReadBook, onOpenWork, onError, onToast, registerBack }: Props) {
  const [settings, setSettings] = useState(false), [settingsBusy, setSettingsBusy] = useState(false);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [videos, setVideos] = useState<VideoDownload[]>([]);
  const rateMeter = useRef(new DownloadRateMeter());
  const [rates, setRates] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [kind, setKind] = useState<DownloadKind | "all">("all");
  const [confirm, setConfirm] = useState<DownloadTask | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const lifecycle = useRef(0);
  const revision = useRef(0);
  const pendingActions = useRef(new Set<string>());
  const pendingRead = useRef<{ promise: Promise<void>; next?: Promise<void> } | null>(null);

  const refresh = useCallback(function read(): Promise<void> {
    if (!alive.current) return Promise.resolve();
    const epoch = lifecycle.current;
    const previous = pendingRead.current;
    if (previous) return previous.next ?? (previous.next = previous.promise.then(() => {
      if (alive.current && lifecycle.current === epoch) return read();
    }));
    const token = ++revision.current;
    setRefreshing(true);
    const request = { promise: Promise.resolve() } as { promise: Promise<void>; next?: Promise<void> };
    pendingRead.current = request;
    request.promise = Promise.allSettled([Promise.resolve().then(() => downloadCenterApi.jobs()), Promise.resolve().then(() => downloadCenterApi.videos())]).then(([books, video]) => {
      if (!alive.current || revision.current !== token || lifecycle.current !== epoch) return;
      const errors: string[] = [];
      if (books.status === "fulfilled") setJobs(books.value); else errors.push("书籍和文件任务读取失败");
      if (video.status === "fulfilled") setVideos(video.value); else errors.push("视频任务读取失败");
      setReadErrors(errors); setLoading(false);
    }).finally(() => {
      if (pendingRead.current === request) { pendingRead.current = null; if (alive.current) setRefreshing(false); }
    });
    return request.promise;
  }, []);

  useEffect(() => {
    alive.current = true;
    const epoch = ++lifecycle.current;
    void refresh();
    let stop: (() => void) | undefined;
    const changed = () => { if (!document.hidden) void refresh(); };
    void downloadCenterApi.subscribe(changed).then(value => { if (alive.current && lifecycle.current === epoch) stop = value; else value(); }).catch(() => {});
    window.addEventListener("focus", changed); document.addEventListener("visibilitychange", changed);
    return () => {
      alive.current = false; lifecycle.current++; revision.current++; pendingRead.current = null;
      stop?.(); window.removeEventListener("focus", changed); document.removeEventListener("visibilitychange", changed);
    };
  }, [refresh]);

  const tasks = useMemo(() => mergeDownloadTasks(jobs, videos), [jobs, videos]);
  useEffect(() => {
    const now = performance.now(), values: Record<string, number | null> = {};
    rateMeter.current.retain(new Set(tasks.map(task => task.key)));
    for (const task of tasks) values[task.key] = rateMeter.current.sample(task.key, task.bytesDownloaded, task.state === "downloading", now);
    setRates(values);
  }, [tasks]);
  const active = tasks.some(activeDownload);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const completed = tasks.filter(task => task.state === "completed");
  const ongoing = tasks.filter(task => task.state !== "completed");
  const shown = (tab === "completed" ? completed : ongoing).filter(task => kind === "all" || task.kind === kind);
  const confirmTask = tasks.find(task => task.key === confirm?.key) ?? confirm;
  const confirming = !!confirmTask && pending.includes(confirmTask.key);
  useEffect(() => {
    registerBack?.(() => { if (settings) { if (!settingsBusy) setSettings(false); return true; } if (confirm) { if (!confirming) setConfirm(null); return true; } return false; });
    return () => registerBack?.(null);
  }, [registerBack, settings, settingsBusy, confirm, confirming]);
  useEffect(() => {
    if (!confirm) return;
    const node = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    if (node && !node.open) node.showModal();
    return () => { node?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [confirm]);

  async function perform(task: DownloadTask, action: DownloadAction | "open") {
    if (pendingActions.current.has(task.key)) return;
    pendingActions.current.add(task.key); setPending([...pendingActions.current]);
    setOperationErrors(previous => { const next = { ...previous }; delete next[task.key]; return next; });
    revision.current++;
    try {
      if (action === "open") {
        if (task.kind === "video") await downloadCenterApi.openVideo(task.id);
        else if (task.kind === "file" && task.mediaFileId) await downloadCenterApi.openFile(task.mediaFileId);
        else if ((task.kind === "comic" || task.kind === "novel") && task.pathWord && task.entryId) await onReadBook({ kind: task.kind, pathWord: task.pathWord, entryId: task.entryId, group: task.group ?? "" });
        else throw new Error("此下载的打开信息不完整，请在作品详情中查看。");
      } else {
        await downloadCenterApi.control(task, action);
        revision.current++;
        if (!alive.current) return;
        if (action === "remove") { setConfirm(null); onToast?.(task.state === "completed" ? "正在清除离线内容" : "正在移除下载任务"); }
        await refresh();
      }
    } catch (reason) {
      if (alive.current) { setOperationErrors(previous => ({ ...previous, [task.key]: errorMessage(reason) })); onError?.(reason); }
    } finally {
      pendingActions.current.delete(task.key);
      if (alive.current) setPending([...pendingActions.current]);
    }
  }

  return <section className="gz-download-center" aria-label="下载中心">
    <header className="gz-download-heading"><h2>下载中心</h2><div className="gz-download-head-actions"><button type="button" className={`gz-iconbtn${refreshing ? " is-refreshing" : ""}`} title="刷新下载任务" aria-label="刷新下载任务" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={20} /></button><button type="button" className="gz-iconbtn" title="下载设置" aria-label="下载设置" onClick={() => setSettings(true)}><Settings size={20} /></button></div></header>
    <div className="gz-download-overview"><span><Download size={15} />{tasks.length} 个任务</span><span><HardDrive size={15} />已下载 {downloadBytes(tasks.reduce((total, task) => total + task.bytesDownloaded, 0))}</span></div>
    <div className="gz-download-toolbar">
      <div className="gz-shelf-tabs" role="tablist" aria-label="下载状态">
        <button type="button" role="tab" aria-selected={tab === "active"} className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>进行中 <span>{ongoing.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "completed"} className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>已完成 <span>{completed.length}</span></button>
      </div>
      <label className="gz-download-filter"><span className="gz-meta">类型</span><select aria-label="下载类型" value={kind} onChange={event => setKind(event.target.value as DownloadKind | "all")}><option value="all">全部</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {readErrors.length > 0 && <div className="gz-download-error" role="alert"><span>{readErrors.join("；")}，请重试。</span><button type="button" className="gz-iconbtn" aria-label="重试读取下载任务" title="重试读取下载任务" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={18} /></button></div>}
    {loading ? <LoadingIndicator label="正在读取下载任务…" compact /> : shown.length ? <div className="gz-download-list" role="list" aria-label={tab === "completed" ? "已完成下载" : "进行中的下载"}>
      {shown.map(task => {
        const Icon = kindIcons[task.kind];
        const percent = downloadProgress(task);
        const busy = pending.includes(task.key) || task.state === "removing";
        const label = task.itemTitle || task.title;
        const waitingWifi = task.state === "queued" && ["offline_waiting_wifi", "等待 Wi-Fi 连接"].includes(task.error ?? "");
        const control = task.state === "queued" || task.state === "downloading" ? "pause" : task.state === "paused" || task.state === "interrupted" ? "resume" : task.state === "failed" ? "retry" : null;
        const canOpen = task.kind === "video" || task.kind === "file" && !!task.mediaFileId || (task.kind === "comic" || task.kind === "novel") && !!task.pathWord && !!task.entryId;
        return <article key={task.key} className="gz-download-row" role="listitem" data-download-key={task.key}>
          <div className={`gz-download-kind kind-${task.kind}`} title={kindLabels[task.kind]}><Icon size={23} aria-hidden="true" /></div>
          <div className="gz-download-content">
            <div className="gz-download-title">{task.workId ? <button type="button" title={task.title} onClick={() => onOpenWork(task.workId!)}>{task.title}</button> : <strong title={task.title}>{task.title}</strong>}<span className={`gz-download-state state-${task.state}`}>{task.state === "completed" && <Check size={13} />}{waitingWifi ? "等待 Wi-Fi" : stateLabels[task.state]}</span></div>
            {task.itemTitle && <p className="gz-download-item" title={task.itemTitle}>{task.itemTitle}</p>}
            <p className="gz-download-metrics"><span>{kindLabels[task.kind]} · {downloadDetail(task)}</span>{task.state !== "completed" && percent != null && <span>{Math.floor(percent)}%</span>}</p>
            {task.state !== "completed" && <progress max={100} value={percent ?? undefined} aria-label={`${label}下载进度`} />}
            {task.state === "downloading" && <p className="gz-meta gz-download-rate">{downloadRateLabel(rates[task.key] ?? null, task.totalBytes == null ? undefined : task.totalBytes - task.bytesDownloaded)}</p>}
            {(!waitingWifi && task.error || operationErrors[task.key]) && <p className="gz-download-row-error" role="alert">{operationErrors[task.key] || downloadErrorLabel(task.error!)}</p>}
          </div>
          <div className="gz-download-actions">
            {task.state === "completed" && <button type="button" className="gz-download-open" disabled={busy || !canOpen} aria-label={`${task.kind === "comic" || task.kind === "novel" ? "阅读" : "播放"} ${label}`} title={task.kind === "comic" || task.kind === "novel" ? "阅读" : "播放"} onClick={() => void perform(task, "open")}>{task.kind === "comic" || task.kind === "novel" ? <BookOpen size={19} /> : <Play size={19} />}<span>{task.kind === "comic" || task.kind === "novel" ? "阅读" : "播放"}</span></button>}
            {control && <button type="button" className="gz-iconbtn" disabled={busy} aria-label={`${control === "pause" ? "暂停" : control === "resume" ? "继续" : "重试"} ${label}`} title={control === "pause" ? "暂停" : control === "resume" ? "继续下载" : "重试下载"} onClick={() => void perform(task, control)}>{control === "pause" ? <Pause size={20} /> : control === "resume" ? <Play size={20} /> : <RefreshCw size={20} />}</button>}
            <button type="button" className="gz-iconbtn gz-download-remove" disabled={busy} aria-label={`${task.state === "completed" ? "清除离线内容" : "移除任务"} ${label}`} title={task.state === "completed" ? "清除离线内容" : "移除任务"} onClick={() => setConfirm(task)}>{task.state === "completed" ? <Trash2 size={19} /> : <X size={20} />}</button>
          </div>
        </article>;
      })}
    </div> : !readErrors.length && <div className="gz-download-empty"><Download size={28} aria-hidden="true" /><h3>{kind === "all" ? tab === "completed" ? "暂无已完成的下载" : "暂无进行中的下载" : `暂无${kindLabels[kind]}${tab === "completed" ? "离线内容" : "下载任务"}`}</h3></div>}
    {settings && <DownloadSettings onClose={() => setSettings(false)} onBusyChange={setSettingsBusy} />}
    {confirmTask && <dialog ref={dialog} className="gz-download-confirm" data-download-confirm aria-labelledby="gz-download-confirm-title"
      onCancel={event => { event.preventDefault(); if (!confirming) setConfirm(null); }} onClose={() => setConfirm(null)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!confirming) setConfirm(null); } }}
      onClick={event => { if (event.target === event.currentTarget && !confirming) setConfirm(null); }}>
      <section><h2 id="gz-download-confirm-title">{confirmTask.state === "completed" ? "清除离线内容" : "移除下载任务"}</h2><p className="gz-download-confirm-item">{confirmTask.title}{confirmTask.itemTitle && ` · ${confirmTask.itemTitle}`}</p><p className="gz-meta">移除任务并清除此下载的本机缓存，阅读位置、书签和源文件保留。</p>
        {operationErrors[confirmTask.key] && <p className="gz-download-row-error" role="alert">{operationErrors[confirmTask.key]}</p>}
        <div className="gz-download-confirm-actions"><button type="button" className="gz-btn" disabled={confirming} autoFocus onClick={() => setConfirm(null)}>取消</button><button type="button" className="gz-btn gz-download-confirm-delete" disabled={confirming} onClick={() => void perform(confirmTask, "remove")}><Trash2 size={17} />{confirming ? "正在处理…" : confirmTask.state === "completed" ? "清除" : "移除"}</button></div>
      </section>
    </dialog>}
  </section>;
}
