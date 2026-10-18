import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import DownloadCenter from "../../src/android/DownloadCenter";
import { downloadCenterApi, type DownloadJob, type DownloadTask, type VideoDownload } from "../../src/android/downloadCenterApi";
import type { PlayerSnapshot } from "../../src/android/api";
import "../../src/android/mobile.css";

const qa = window as any;
const root = createRoot(document.getElementById("root")!);
const MB = 1024 ** 2;
const stamp = "2026-10-14T10:00:00Z";
const book = (id: string, patch: Partial<DownloadJob>): DownloadJob => ({ id, kind: "comic", title: "合成漫画作品", itemTitle: "第01话", state: "downloading", bytesDownloaded: 8 * MB, completedUnits: 12, totalUnits: 48, createdAt: stamp, updatedAt: stamp, pathWord: "sample-comic", entryId: id, group: "default", workId: "work-comic", ...patch });
let jobs: DownloadJob[] = [], videos: VideoDownload[] = [];
let delayReads = false, failJobs = false, failVideos = false, slowControl = false, failControl = false;
let mount = 0;
const reads: (() => void)[] = [], controls: (() => void)[] = [];
const subscribers = new Set<() => void>();
const calls: any[] = [];
let selectedStorage = "internal";
let wifiOnly = false;
qa.__qaStorageFailure = "";
qa.__qaSaveStorageFailure = false;
qa.__qaBack = null;
qa.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
  const locations = [{id:"internal",label:"应用内部存储",path:"/data/user/0/com.genzo.android.qa",freeBytes:12*1024**3},
    {id:"external:primary",label:"手机存储（应用专属目录）",path:"/storage/emulated/0/Android/data/com.genzo.android.qa/files/YukiDownloads",freeBytes:20*1024**3}];
  if (command === "get_download_storage") {
    if (qa.__qaStorageFailure) throw qa.__qaStorageFailure;
    return {selected:selectedStorage,available:locations.some(item=>item.id===selectedStorage),locations,wifiOnly};
  }
  if (command === "set_download_storage") {
    calls.push({action:"storage",id:args.id,wifiOnly:args.wifiOnly});
    if (qa.__qaSaveStorageFailure) throw "下载目录不可用或无法写入，请重新选择";
    selectedStorage=args.id; wifiOnly=args.wifiOnly ?? wifiOnly; return {selected:selectedStorage,available:true,locations,wifiOnly};
  }
  throw new Error(`Unexpected storage command ${command}`);
} };
qa.__qaSelectStorage = (id: string) => selectedStorage=id;
function reset() {
  jobs = [book("shared", { title: "合成漫画作品：很长的标题需要自然换行而不能挤住下载操作按钮" }),
    book("novel-queued", { kind: "novel", title: "合成小说", itemTitle: "第一卷", state: "queued", bytesDownloaded: 0, completedUnits: 0, totalUnits: null, pathWord: "sample-novel", workId: null }),
    book("file-paused", { kind: "file", title: "合成动画", itemTitle: "LongFileNameWithoutSpacesForNarrowWindowRegressionEpisode13.mkv", state: "paused", bytesDownloaded: 100 * MB, totalBytes: 512 * MB, completedUnits: 0, totalUnits: 1, mediaFileId: "file13", pathWord: null, entryId: null }),
    book("comic-failed", { title: "合成漫画二", itemTitle: "第06话", state: "failed", completedUnits: 2, totalUnits: 24, error: "来源暂时不可用，请稍后重试。" }),
    book("comic-completed", { state: "completed", itemTitle: "第08话", completedUnits: 24, totalUnits: 24, bytesDownloaded: 21 * MB, totalBytes: 21 * MB }),
    book("novel-completed", { kind: "novel", title: "合成小说", state: "completed", itemTitle: "第二卷", completedUnits: 9, totalUnits: 9, bytesDownloaded: 4 * MB, totalBytes: 4 * MB, pathWord: "sample-novel", workId: "work-novel" }),
    book("file-completed", { kind: "file", title: "合成动画", state: "completed", itemTitle: "第14集.mkv", completedUnits: 1, totalUnits: 1, bytesDownloaded: 300 * MB, totalBytes: 300 * MB, mediaFileId: "file14", pathWord: null, entryId: null })];
  videos = [{ id: "shared", kind: "video", title: "合成规则动画", episodeTitle: "第01集", state: "downloading", bytesDownloaded: 96 * MB, totalBytes: 384 * MB, createdAt: stamp, updatedAt: stamp, workId: "work-video" },
    { id: "video-completed", kind: "video", title: "合成规则动画", episodeTitle: "第02集", state: "completed", bytesDownloaded: 128 * MB, totalBytes: 128 * MB, createdAt: stamp, updatedAt: stamp, workId: "work-video" }];
  delayReads = failJobs = failVideos = slowControl = failControl = false;
}
function emit() { subscribers.forEach(callback => callback()); }
downloadCenterApi.jobs = async () => {
  calls.push({ action: "jobs" }); if (failJobs) throw new Error("controlled offline books");
  const snapshot = [...jobs, ...(jobs.some(item => item.id === "shared") ? [book("shared", { updatedAt: "2026-10-14T09:00:00Z", state: "failed" })] : [])].map(item => ({ ...item }));
  return delayReads ? new Promise(resolve => reads.push(() => resolve(snapshot))) : snapshot;
};
downloadCenterApi.videos = async () => {
  calls.push({ action: "videos" }); if (failVideos) throw new Error("controlled offline videos");
  const snapshot = videos.map(item => ({ ...item }));
  return delayReads ? new Promise(resolve => reads.push(() => resolve(snapshot))) : snapshot;
};
downloadCenterApi.subscribe = async changed => { subscribers.add(changed); return () => { subscribers.delete(changed); }; };
downloadCenterApi.control = async (task, action) => {
  calls.push({ action, key: task.key });
  if (failControl) throw new Error("合成操作失败，请重试。");
  if (slowControl && task.source === "job") await new Promise<void>(resolve => controls.push(resolve));
  if (action === "remove") {
    if (task.source === "job") jobs = jobs.filter(item => item.id !== task.id); else videos = videos.filter(item => item.id !== task.id);
  } else {
    const item = (task.source === "job" ? jobs : videos).find(item => item.id === task.id)!;
    item.state = action === "pause" ? "paused" : action === "retry" ? "queued" : "downloading";
    item.error = null; item.updatedAt = "2026-10-14T11:00:00Z";
  }
  emit();
};
downloadCenterApi.openVideo = async id => { calls.push({ action: "openVideo", id }); return {} as PlayerSnapshot; };
downloadCenterApi.openFile = async mediaFileId => { calls.push({ action: "openFile", mediaFileId }); return {} as PlayerSnapshot; };
qa.__qaCalls = calls;
qa.__qaFlag = (name: string, value: boolean) => { if (name === "delayReads") delayReads = value; if (name === "failJobs") failJobs = value; if (name === "failVideos") failVideos = value; if (name === "slowControl") slowControl = value; if (name === "failControl") failControl = value; };
qa.__qaResolveReads = () => { reads.splice(0).forEach(resolve => resolve()); };
qa.__qaResolveControls = () => { controls.splice(0).forEach(resolve => resolve()); };
qa.__qaEmit = emit;
qa.__qaChangeBytes = () => { jobs[0]!.bytesDownloaded = 12 * MB; };
qa.__qaWaitWifi = () => { jobs[0]!.state = "queued"; jobs[0]!.error = "等待 Wi-Fi 连接"; emit(); };
qa.__qaEmpty = () => { jobs = []; videos = []; };
qa.__qaMount = (empty = false) => {
  reset(); if (empty) qa.__qaEmpty();
  flushSync(() => root.render(<StrictMode><div className="android-app" data-theme="dark" style={{ gridTemplateRows: "minmax(0,1fr)" }}><main className="gz-scroll">
    <DownloadCenter key={++mount} registerBack={handler => qa.__qaBack=handler} onReadBook={target => { calls.push({ action: "read", ...target }); }} onOpenWork={id => calls.push({ action: "work", id })} onToast={message => calls.push({ action: "toast", message })} onError={reason => calls.push({ action: "error", reason: String(reason) })} />
  </main></div></StrictMode>));
};
qa.__qaUnmount = () => flushSync(() => root.render(<div>下载页已离开</div>));
qa.__qaMount();
