import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeDownload, downloadBytes, downloadCenterApi, downloadErrorLabel, downloadProgress, mergeDownloadTasks, type DownloadJob, type DownloadTask, type VideoDownload } from "./downloadCenterApi";
import { downloadDetail } from "./DownloadCenter";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));

const job = (id: string, patch: Partial<DownloadJob> = {}): DownloadJob => ({ id, kind: "comic", title: "作品", itemTitle: "第01话", state: "downloading", bytesDownloaded: 10 * 1024, completedUnits: 2, createdAt: "2026-10-14T08:00:00Z", updatedAt: "2026-10-14T08:01:00Z", ...patch });
const task = (patch: Partial<DownloadTask> = {}): DownloadTask => ({ ...job("a"), key: "job:a", source: "job", ...patch });

describe("download center snapshots", () => {
  it("keeps distinct backend identities and the newest duplicate without hiding a video", () => {
    const video: VideoDownload = { id: "same", kind: "video", title: "动画", episodeTitle: "第02集", state: "completed", bytesDownloaded: 512, createdAt: "2026-10-14T09:00:00Z", updatedAt: "2026-10-14T09:01:00Z" };
    const merged = mergeDownloadTasks([job("same"), job("same", { state: "paused", updatedAt: "2026-10-14T08:02:00Z" }), job("same", { state: "failed", updatedAt: "2026-10-14T08:00:00Z" })], [video]);
    expect(merged.map(item => item.key)).toEqual(["video:same", "job:same"]);
    expect(merged[0]?.itemTitle).toBe("第02集"); expect(merged[1]?.state).toBe("paused");
  });
  it("uses actual byte or resource totals and leaves unknown totals indeterminate", () => {
    expect(downloadProgress(task({ totalBytes: 40 * 1024 }))).toBe(25);
    expect(downloadProgress(task({ totalUnits: 8 }))).toBe(25);
    expect(downloadProgress(task({ totalBytes: null, totalUnits: null }))).toBeNull();
    expect(downloadProgress(task({ kind: "video", completedUnits: undefined, percent: 46 }))).toBe(46);
    expect(downloadProgress(task({ percent: -1 }))).toBeNull();
    expect(downloadProgress(task({ totalBytes: 1, bytesDownloaded: 2 }))).toBe(100);
  });
  it("labels novel正文 and illustrations as resources rather than chapters", () => {
    expect(downloadDetail(task({ kind: "novel", completedUnits: 2, totalUnits: 9 }))).toBe("10.0 KB · 2 / 9 项资源");
    expect(downloadDetail(task({ kind: "comic", totalUnits: 20 }))).toBe("10.0 KB · 2 / 20 页");
    expect(downloadDetail(task({ kind: "file", completedUnits: 0, totalUnits: 1 }))).toBe("10.0 KB · 0 / 1 个文件");
  });
  it("polls only changing states and formats actual downloaded bytes", () => {
    for (const state of ["queued", "downloading", "removing"] as const) expect(activeDownload(task({ state }))).toBe(true);
    for (const state of ["paused", "failed", "interrupted", "completed"] as const) expect(activeDownload(task({ state }))).toBe(false);
    expect(downloadBytes(0)).toBe("0 B"); expect(downloadBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
  it("maps safe error codes to Chinese without rendering unknown URLs or credentials", () => {
    expect(downloadErrorLabel("offline_download_resolve_failed")).toContain("地址解析失败");
    expect(downloadErrorLabel("offline_live_unsupported")).toContain("直播流");
    expect(downloadErrorLabel("offline_drm_unsupported")).toContain("DRM");
    expect(downloadErrorLabel("无法写入本机缓存，请检查可用空间后重试。")).toContain("可用空间");
    expect(downloadErrorLabel("https://private.example/video?token=secret")).toBe("下载失败，请重试或检查来源。");
    expect(downloadErrorLabel("unknown_native_failure")).toBe("下载失败，请重试或检查来源。");
    expect(downloadErrorLabel("__proto__")).toBe("下载失败，请重试或检查来源。");
  });
});

describe("download command contract", () => {
  beforeEach(() => { ipc.invoke.mockReset(); ipc.listen.mockReset(); });
  it("reads separate book/file jobs and the native video's downloads envelope", async () => {
    const jobs = [job("book")];
    const videos = [{ id: "video", kind: "video" }];
    ipc.invoke.mockResolvedValueOnce(jobs).mockResolvedValueOnce({ downloads: videos });
    expect(await downloadCenterApi.jobs()).toEqual(jobs);
    expect(await downloadCenterApi.videos()).toEqual(videos);
    expect(ipc.invoke.mock.calls).toEqual([["list_download_jobs"], ["list_video_downloads"]]);
  });
  it("controls stable backend IDs and opens downloaded files without online playback", async () => {
    await downloadCenterApi.control(task({ id: "comic", source: "job" }), "pause");
    await downloadCenterApi.control(task({ id: "rule", source: "video", kind: "video" }), "retry");
    await downloadCenterApi.openVideo("completed-rule");
    await downloadCenterApi.openFile("stable-media");
    expect(ipc.invoke.mock.calls).toEqual([
      ["control_download_job", { id: "comic", action: "pause" }],
      ["control_video_download", { id: "rule", action: "retry" }],
      ["open_downloaded_video", { id: "completed-rule" }],
      ["open_downloaded_file", { mediaFileId: "stable-media" }],
    ]);
  });
  it("subscribes to both queues and cleans an earlier listener if the next subscription fails", async () => {
    const changed = vi.fn(), stopJobs = vi.fn(), stopVideos = vi.fn();
    ipc.listen.mockResolvedValueOnce(stopJobs).mockResolvedValueOnce(stopVideos);
    const stop = await downloadCenterApi.subscribe(changed);
    expect(ipc.listen.mock.calls).toEqual([["download-jobs-updated", changed], ["video-downloads-updated", changed]]);
    stop();
    expect(stopJobs).toHaveBeenCalledOnce(); expect(stopVideos).toHaveBeenCalledOnce();
    ipc.listen.mockReset(); stopJobs.mockClear();
    ipc.listen.mockResolvedValueOnce(stopJobs).mockRejectedValueOnce(new Error("controlled missing native event"));
    await expect(downloadCenterApi.subscribe(changed)).rejects.toThrow("controlled missing native event");
    expect(stopJobs).toHaveBeenCalledOnce();
  });
});
