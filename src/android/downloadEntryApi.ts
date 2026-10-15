import { invoke } from "@tauri-apps/api/core";
import type { ReadingKind, SourceEntry } from "../bookContent";
import type { DownloadJob } from "./downloadCenterApi";

export const downloadEntryApi = {
  books: (kind: ReadingKind, pathWord: string, group: string, title: string, entries: Pick<SourceEntry, "id" | "title">[]) =>
    invoke<DownloadJob[]>("enqueue_book_downloads", { kind, pathWord, group, title, entries }),
  file: (mediaFileId: string) => invoke<DownloadJob>("enqueue_file_download", { mediaFileId }),
  ruleMedia: (mediaFileId: string) => invoke<unknown[]>("enqueue_rule_media_download", { mediaFileId }),
  rules: (input: { pluginId: string; source: string; title: string; roadIndex: number; episodeIndexes: number[]; workId?: string }) =>
    invoke<unknown[]>("enqueue_rule_downloads", { input }),
};
