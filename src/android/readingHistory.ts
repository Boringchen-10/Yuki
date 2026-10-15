import { invoke } from "@tauri-apps/api/core";
import type { ReadingKind } from "../bookContent";

export interface ReadingHistoryItem {
  kind: ReadingKind;
  pathWord: string;
  group: string;
  entryId: string;
  workId: string | null;
  title: string;
  entryTitle: string;
  coverPath: string | null;
  coverUrl: string | null;
  location: { pageIndex?: number; offset?: number; href?: string; locations?: { progression?: number; totalProgression?: number } } | null;
  pageCount: number | null;
  updatedAt: string;
}

export const readingHistoryKey = (item: Pick<ReadingHistoryItem, "kind" | "pathWord" | "group" | "entryId">) =>
  JSON.stringify([item.kind, item.pathWord, item.group, item.entryId]);

export function readingLocationLabel(item: Pick<ReadingHistoryItem, "kind" | "location" | "pageCount">): string {
  if (item.kind === "comic") {
    const index = item.location?.pageIndex;
    if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
      return `第 ${index + 1} 页${item.pageCount != null && item.pageCount > index ? ` / 共 ${item.pageCount} 页` : ""}`;
    }
  } else {
    const { totalProgression, progression } = item.location?.locations ?? {};
    if (typeof totalProgression === "number" && totalProgression >= 0 && totalProgression <= 1) return `本卷已读 ${Math.round(totalProgression * 100)}%`;
    if (typeof progression === "number" && progression >= 0 && progression <= 1) return `本节已读 ${Math.round(progression * 100)}%`;
  }
  return "已保存阅读位置";
}

export const readingHistoryApi = {
  list: () => invoke<ReadingHistoryItem[]>("list_reading_history"),
  remove: ({ kind, pathWord, group, entryId }: ReadingHistoryItem) => invoke<void>("remove_reading_history", { kind, pathWord, group, entryId }),
  clear: () => invoke<void>("clear_reading_history"),
};
