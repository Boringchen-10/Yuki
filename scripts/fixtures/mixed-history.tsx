import { createRoot } from "react-dom/client";
import AndroidApp from "../../src/android/AndroidApp";
import { readingHistoryKey, type ReadingHistoryItem } from "../../src/android/readingHistory";
import { usePreferences } from "../../src/store";
import "../../src/android/mobile.css";

const qa = window as any;
const calls: { command: string; args: any }[] = [];
const settings = new Map<string, string>(), hiddenBooks = new Set<string>();
const readingWaits: (() => void)[] = [], removeWaits: (() => void)[] = [];
let delayHistory = false, slowRemove = false, failHistory = false, failRemove = false;
const file = (id: string, workId: string): any => ({ id, workId, libraryRootId: "qa-source", path: `saf:qa/${id}.mkv`, fileName: `${id}.mkv`, mediaType: "video", missing: false, parsedEpisode: 1 });
const files = [file("anime-file", "anime"), file("movie-file", "movie")];
const works: any[] = [
  ["anime", "合成动画", "video", "anime"], ["movie", "合成电影", "video", "movie"], ["comic", "合成漫画", "comic", "comic"], ["novel", "合成小说", "novel", "novel"],
].map(([id, title, type, category]) => ({ id, title, originalTitle: null, type, category, coverPath: null, status: "in_progress", favorite: false, rating: 8, notes: "个人记录保留", description: "合成作品", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", tags: [], mediaCount: type === "video" ? 1 : 0, sourceScopes: [], mediaFiles: files.filter(file => file.workId === id), metadata: null, fieldLocks: [], candidates: [], subtitleLinks: [] }));
const progress: any[] = [
  { mediaFileId: "anime-file", workId: "anime", title: "合成动画", fileName: "Anime-Episode01.mkv", positionMs: 123000, durationMs: 1440000, completed: false, missing: false, updatedAt: "2026-10-14T10:04:00Z" },
  { mediaFileId: "movie-file", workId: "movie", title: "合成电影", fileName: "Movie-Episode02.mkv", positionMs: 456000, durationMs: 7200000, completed: false, missing: false, updatedAt: "2026-10-14T10:02:00Z" },
];
const readings: ReadingHistoryItem[] = [
  { kind: "comic", pathWord: "qa-comic", group: "default", entryId: "chapter-13", workId: "comic", title: "合成漫画", entryTitle: "第13话 Chapter-Fox", coverPath: null, coverUrl: null, location: { pageIndex: 12 }, pageCount: 48, updatedAt: "2026-10-14T10:03:00Z" },
  { kind: "novel", pathWord: "qa-novel", group: "volumes", entryId: "volume-2", workId: "novel", title: "合成小说", entryTitle: "第二卷 Volume-Moon", coverPath: null, coverUrl: null, location: { href: "chapter.xhtml", locations: { totalProgression: .37 } }, pageCount: null, updatedAt: "2026-10-14T10:01:00Z" },
];
const sources: any[] = [{ id: "qa-source", kind: "saf", label: "合成本地来源", enabled: true, state: "ready", lastScannedAt: "2026-10-01T00:00:00Z" }];
const bookmarks = [{ kind: "comic", pathWord: "qa-comic", entryId: "chapter-13", location: { pageIndex: 9 } }];
const caches = [{ kind: "comic", pathWord: "qa-comic", entryId: "chapter-13", pages: 48 }, { kind: "novel", pathWord: "qa-novel", entryId: "volume-2", bytes: 8192 }];
const protectedState = () => JSON.stringify({ works, files, progress, readings, sources, bookmarks, caches });
const copy = <T,>(value: T): T => structuredClone(value);
qa.isTauri = true;
qa.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
qa.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value: string) => value,
  invoke: async (command: string, args: any = {}) => {
    calls.push({ command, args: copy(args) });
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten" || command === "set_android_appearance") return;
    if (command === "android_native" && args.command === "safeArea") return { top: 0, bottom: 0, left: 0, right: 0 };
    if (command === "sync_status") return { connected: false, enabled: false };
    if (command === "get_book_shelf_state") return {};
    if (command === "get_setting") return settings.get(args.key) || null;
    if (command === "set_setting") { settings.set(args.key, args.value); return; }
    if (command === "list_works") return copy(works);
    if (["list_unassigned_media_groups", "list_scan_tasks", "list_source_imports", "list_work_rule_sources", "list_book_entries"].includes(command)) return [];
    if (command === "get_video_source_states") return copy(sources);
    if (command === "get_internal_player_state") return { status: "closed", sessionId: null, mediaFileId: null };
    if (command === "get_playback_progress") return { items: copy(progress), sessions: [] };
    if (command === "list_reading_history") {
      if (failHistory) throw new Error("合成阅读历史读取失败");
      const snapshot = copy(readings.filter(item => !hiddenBooks.has(readingHistoryKey(item))));
      return delayHistory ? new Promise(resolve => readingWaits.push(() => resolve(snapshot))) : snapshot;
    }
    if (command === "remove_reading_history") {
      if (slowRemove) await new Promise<void>(resolve => removeWaits.push(resolve));
      if (failRemove) throw new Error("合成阅读记录移除失败");
      hiddenBooks.add(readingHistoryKey(args)); return;
    }
    if (command === "clear_reading_history") { readings.forEach(item => hiddenBooks.add(readingHistoryKey(item))); return; }
    if (command === "open_internal_reader") return;
    if (command === "open_internal_player") return { sessionId: "qa-play", mediaFileId: args.mediaFileId, status: "opening" };
    if (command === "get_work") return copy(works.find(work => work.id === args.id));
    if (command === "get_book_reading_source") return null;
    if (command === "get_book_entry_order") return { mode: "number", entryIds: [] };
    if (command === "update_book_shelf_state") return { hidden: false, browsedAt: "2026-10-15T00:00:00Z", collectedAt: "2026-10-01T00:00:00Z" };
    if (command === "get_anime_work_structure") return { workId: args.workId, episodes: [], seasons: [], characters: [], staff: [], unmatchedFiles: [], warnings: [] };
    if (command === "get_episode_artwork") return { images: {}, cachedImages: {}, warnings: [], source: null };
    throw new Error(`Unexpected mixed-history command: ${command}`);
  },
};
qa.__qaCalls = calls;
qa.__qaProtected = protectedState;
qa.__qaHidden = () => ({ videos: JSON.parse(settings.get("android.history.hidden.v1") || "{}"), books: [...hiddenBooks] });
qa.__qaFlag = (name: string, value: boolean) => { if (name === "delayHistory") delayHistory = value; if (name === "slowRemove") slowRemove = value; if (name === "failHistory") failHistory = value; if (name === "failRemove") failRemove = value; };
qa.__qaPendingReads = () => readingWaits.length;
qa.__qaResolveReads = () => readingWaits.splice(0).forEach(resolve => resolve());
qa.__qaResolveRemoves = () => removeWaits.splice(0).forEach(resolve => resolve());
qa.__qaRefresh = () => window.dispatchEvent(new Event("focus"));
qa.__qaWatchAgain = () => { progress[0].updatedAt = "2026-10-15T10:05:00Z"; qa.__qaRefresh(); };
qa.__qaReadAgain = () => { readings[0].updatedAt = "2026-10-15T10:06:00Z"; hiddenBooks.delete(readingHistoryKey(readings[0])); qa.__qaRefresh(); };
usePreferences.setState({ theme: "dark" });
history.replaceState({ genzoDepth: 0 }, "", "#/history");
createRoot(document.getElementById("root")!).render(<AndroidApp />);
