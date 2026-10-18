import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlayerSnapshot } from "./api";

export type DownloadKind = "video" | "comic" | "novel" | "file";
export type DownloadState = "queued" | "downloading" | "paused" | "interrupted" | "failed" | "completed" | "removing";
export type DownloadAction = "pause" | "resume" | "retry" | "remove";

interface DownloadFields {
  id: string;
  title: string;
  state: DownloadState;
  bytesDownloaded: number;
  totalBytes?: number | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  mediaFileId?: string | null;
  workId?: string | null;
}
export interface DownloadJob extends DownloadFields {
  kind: "comic" | "novel" | "file";
  itemTitle: string;
  completedUnits: number;
  totalUnits?: number | null;
  pathWord?: string | null;
  group?: string | null;
  entryId?: string | null;
}
export interface VideoDownload extends DownloadFields {
  kind: "video";
  episodeTitle?: string | null;
  percent?: number | null;
  recipe?: unknown;
}
export interface DownloadTask extends DownloadFields {
  key: string;
  source: "job" | "video";
  kind: DownloadKind;
  itemTitle: string;
  completedUnits?: number;
  totalUnits?: number | null;
  percent?: number | null;
  pathWord?: string | null;
  group?: string | null;
  entryId?: string | null;
}
export type DownloadReadTarget = { kind: "comic" | "novel"; pathWord: string; entryId: string; group: string };

export const activeDownload = (task: DownloadTask) => ["queued", "downloading", "removing"].includes(task.state);

const downloadErrors: Record<string, string> = {
  offline_waiting_wifi: "仅 Wi-Fi 下载已开启，请连接 Wi-Fi 后继续。",
  offline_storage_unavailable: "下载目录不可用，请插入 SD 卡或在下载设置中选择其他目录。",
  offline_download_resolve_failed: "下载地址解析失败，请检查来源后重试。",
  offline_download_missing: "离线内容已丢失，请重新下载。",
  offline_download_incomplete: "离线内容不完整，请继续下载或重试。",
  offline_not_video: "来源未提供可下载的视频。",
  offline_unsupported_format: "暂不支持此视频格式的离线下载。",
  offline_live_stream: "直播流暂不支持离线下载。",
  offline_live_unsupported: "直播流暂不支持离线下载。",
  offline_drm_unsupported: "暂不支持受 DRM 保护的视频下载。",
  offline_download_failed: "视频下载失败，请检查网络与来源后重试。",
  offline_download_connection_failed: "无法连接视频来源，请检查网络后重试。",
  offline_download_prepare_failed: "无法准备视频下载，请检查来源后重试。",
  offline_credentials_unavailable: "下载授权已失效，请重新验证来源后重试。",
  offline_invalid_playlist: "视频播放列表无效，请检查来源后重试。",
  offline_playlist_too_large: "视频播放列表过大，暂时无法下载。",
  offline_unsupported_playlist: "暂不支持此播放列表的离线下载。",
};
const bookDownloadErrors = new Set([
  "数据库繁忙，请稍后重试。", "无法写入本机缓存，请检查可用空间后重试。",
  "下载来源或文件已不可用，请检查来源后重试。", "连接或传输失败，请检查网络与来源后重试；已完成的下载保留。",
  "下载未完成，请检查来源、可用空间或访问权限后重试。", "上次下载已中断，点击继续后重新连接来源。",
]);
export const downloadErrorLabel = (reason: string) => Object.prototype.hasOwnProperty.call(downloadErrors, reason) ? downloadErrors[reason] : bookDownloadErrors.has(reason) ? reason : "下载失败，请重试或检查来源。";

export function mergeDownloadTasks(jobs: DownloadJob[], videos: VideoDownload[]): DownloadTask[] {
  const tasks = [...jobs.map(task => ({ ...task, key: `job:${task.id}`, source: "job" as const })),
    ...videos.map(task => ({ ...task, key: `video:${task.id}`, source: "video" as const, itemTitle: task.episodeTitle || "" }))];
  const unique = new Map<string, DownloadTask>();
  for (const task of tasks) {
    const previous = unique.get(task.key);
    if (!previous || task.updatedAt >= previous.updatedAt) unique.set(task.key, task);
  }
  return [...unique.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key));
}

export function downloadProgress(task: DownloadTask): number | null {
  if (task.totalBytes != null && task.totalBytes > 0) return Math.min(100, Math.max(0, task.bytesDownloaded / task.totalBytes * 100));
  if (task.totalUnits != null && task.totalUnits > 0 && task.completedUnits != null) return Math.min(100, Math.max(0, task.completedUnits / task.totalUnits * 100));
  if (task.percent != null && Number.isFinite(task.percent) && task.percent >= 0 && task.percent <= 100) return task.percent;
  return null;
}

export function downloadBytes(bytes: number): string {
  const size = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (size < 1024) return `${Math.round(size)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const power = Math.min(4, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** power).toFixed(size / 1024 ** power >= 100 ? 0 : 1)} ${units[power - 1]}`;
}

export const downloadCenterApi = {
  jobs: () => invoke<DownloadJob[]>("list_download_jobs"),
  videos: async () => (await invoke<{ downloads: VideoDownload[] }>("list_video_downloads")).downloads,
  control: (task: DownloadTask, action: DownloadAction) => task.source === "video"
    ? invoke<void>("control_video_download", { id: task.id, action }) : invoke<void>("control_download_job", { id: task.id, action }),
  openVideo: (id: string) => invoke<PlayerSnapshot>("open_downloaded_video", { id }),
  openFile: (mediaFileId: string) => invoke<PlayerSnapshot>("open_downloaded_file", { mediaFileId }),
  subscribe: async (changed: () => void) => {
    const stops: (() => void)[] = [];
    try {
      for (const event of ["download-jobs-updated", "video-downloads-updated"]) stops.push(await listen(event, changed));
      return () => stops.forEach(stop => stop());
    } catch (reason) { stops.forEach(stop => stop()); throw reason; }
  },
};
