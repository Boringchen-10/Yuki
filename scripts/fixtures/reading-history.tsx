import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ReadingHistoryRow from "../../src/android/ReadingHistoryRow";
import type { ReadingHistoryItem } from "../../src/android/readingHistory";
import "../../src/android/mobile.css";

const qa = window as any;
const root = createRoot(document.getElementById("root")!);
const calls: { action: string; item: ReadingHistoryItem }[] = [];
const items: ReadingHistoryItem[] = [
  { kind: "comic", pathWord: "qa-comic", group: "default", entryId: "chapter-1", workId: "qa-comic-work", title: "合成漫画：这是一个很长的标题，用于检查阅读记录中的省略和操作按钮", entryTitle: "第13话：LongChapterNameWithoutSpacesForNarrowWindow", coverPath: null, coverUrl: null, location: { pageIndex: 12 }, pageCount: 48, updatedAt: "2026-10-14T10:31:00Z" },
  { kind: "novel", pathWord: "qa-novel", group: "volumes", entryId: "volume-2", workId: "qa-novel-work", title: "合成轻小说", entryTitle: "第二卷", coverPath: null, coverUrl: null, location: { href: "chapter.xhtml", locations: { progression: .6, totalProgression: .37 } }, pageCount: null, updatedAt: "2026-10-14T10:30:00Z" },
  { kind: "comic", pathWord: "qa-unbound-comic", group: "volumes", entryId: "chapter-1", workId: null, title: "未加入书架的漫画", entryTitle: "单行本第1卷", coverPath: null, coverUrl: null, location: { pageIndex: 4 }, pageCount: null, updatedAt: "2026-10-14T10:29:00Z" },
];
let editing = false, busy = false;
const record = (action: string, item: ReadingHistoryItem) => calls.push({ action, item: structuredClone(item) });
function render() {
  flushSync(() => root.render(<div className="android-app" data-theme="dark" style={{ gridTemplateRows: "minmax(0,1fr)" }}><main className="gz-scroll">
    <section aria-label="阅读记录样本"><h2 style={{ marginBottom: 16 }}>浏览记录</h2>{items.map(item => <ReadingHistoryRow key={`${item.kind}:${item.pathWord}`} item={item} editing={editing} busy={busy}
      onRead={item => record("read", item)} onDetail={item => record("detail", item)} onRemove={item => record("remove", item)} onMore={item => record("more", item)} />)}</section>
  </main></div>));
}
qa.__qaCalls = calls;
qa.__qaItems = items;
qa.__qaEdit = (value: boolean) => { editing = value; render(); };
qa.__qaBusy = (value: boolean) => { busy = value; render(); };
render();
