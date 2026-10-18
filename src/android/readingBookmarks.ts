import { invoke } from "@tauri-apps/api/core";
import type { ReadingHistoryItem } from "./readingHistory";

export interface ReadingBookmark extends Omit<ReadingHistoryItem, "updatedAt"> { id: string; label: string; createdAt: string }
export const readingBookmarksApi = {
  list: () => invoke<ReadingBookmark[]>("list_reading_bookmarks"),
  remove: (id: string) => invoke<void>("remove_reading_bookmark", { id }),
};
