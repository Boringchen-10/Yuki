import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import OnlineChapters from "../../src/android/OnlineChapters";
import RuleBrowser from "../../src/android/RuleBrowser";
import EpisodeSources from "../../src/android/EpisodeSources";
import { androidSession } from "../../src/android/sessionCache";
import "../../src/android/mobile.css";

const qa = window as any;
const calls: any[] = [], pending: (() => void)[] = [];
const callbacks = new Map<number, (event: unknown) => void>(), listeners = new Map<number, { event: string; handler: number }>();
let sequence = 0, slow = false, fail = false, cached = false;
qa.isTauri = true;
qa.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (id: number) => listeners.delete(id) };
qa.__TAURI_INTERNALS__ = {
  transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
  unregisterCallback: (id: number) => callbacks.delete(id), convertFileSrc: (path: string) => path,
  invoke: async (command: string, args: any = {}) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === "plugin:event|listen") { listeners.set(++sequence, args); return sequence; }
    if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
    if (command === "get_reading_resume") return null;
    if (command === "get_book_source_entries") return { group: args.group || "default", groups: [{ id: "default", title: "默认" }, { id: "volumes", title: "单行本" }], total: 3, offset: 0, stale: false,
      entries: [1, 2, 3].map(index => ({ id: `${args.group || "default"}-${index}`, title: `第${index}话${index === 2 ? "：用于窄屏检验的长标题不能挤住下载操作按钮" : ""}`, order: index, count: 24 })) };
    if (command === "list_cached_book_content") return cached ? args.entryIds.map((entryId: string) => ({ entryId, format: "cbz", bytes: 1024, cachedAt: "2026-10-14T00:00:00Z" })) : [];
    if (command === "list_rule_plugins") return [{ id: "qa-rule", name: "合成规则", version: "1", enabled: true, origin: null, updatedAt: "2026-10-14T00:00:00Z" }];
    if (command === "get_rule_chapters") return { stale: false, warning: null, verificationRequired: false, verificationUrl: null, roads: [
      { name: "播放线路1", episodes: [1, 2, 3].map(index => ({ name: `第${index}集${index === 2 ? "：很长的规则集名 / LongEpisodeNameWithoutSpaces" : ""}`, url: `/episode/${index}` })) },
      { name: "播放线路2", episodes: [11, 12].map(index => ({ name: `第${index}集`, url: `/backup/${index}` })) },
    ] };
    if (command.startsWith("enqueue_")) {
      if (slow) await new Promise<void>(resolve => pending.push(resolve));
      if (fail) throw new Error("合成入队失败，请重试。");
      return [];
    }
    throw new Error(`Unexpected fixture command: ${command}`);
  },
};
const file = (id: string, kind: string, missing = false): any => ({ id, workId: "qa-work", libraryRootId: `source-${kind}`, path: `${kind}:qa/${id}.mkv`, fileName: `合成第${id}集LongFileNameForDownloadEntryRegression.mkv`, mediaType: "video", missing });
const files = [file("dav", "webdav"), file("rule", "rule"), file("local", "saf"), file("missing", "webdav", true)];
const structure: any = { workId: "qa-work", episodes: files.map((entry, index) => ({ provider: "bangumi", externalId: String(index + 1), title: `合成分集 ${index + 1}`, episodeNumber: index + 1, sortNumber: index + 1, episodeType: 0, localFiles: [entry] })), unmatchedFiles: [], seasons: [], characters: [], staff: [], warnings: [] };
const sources: any = [{ id: "source-webdav", kind: "webdav", label: "合成 WebDAV", enabled: true }, { id: "source-rule", kind: "rule", label: "合成规则", enabled: true }, { id: "source-saf", kind: "saf", label: "本地", enabled: true }];
const root = createRoot(document.getElementById("root")!);
let mount = 0;
function Fixture({ mode }: { mode: string }) {
  const [selecting, setSelecting] = useState(true);
  return <div className="android-app" data-theme="dark" style={{ gridTemplateRows: "minmax(0,1fr)" }}><main className="gz-scroll">
    {mode.startsWith("book-") ? <OnlineChapters kind={mode === "book-comic" ? "comic" : "novel"} pathWord="qa-book" title="合成书籍" selecting={selecting}
      onSelecting={value => { calls.push({ command: "fixture-selecting", args: { value } }); setSelecting(value); }} onRead={(entry, group) => calls.push({ command: "fixture-read", args: { entry, group } })} onToast={message => calls.push({ command: "fixture-toast", args: { message } })} />
      : mode.startsWith("rules-") ? <RuleBrowser work={mode === "rules-bound" ? { id: "qa-work", title: "已入库动画" } as any : undefined} initialSource={{ pluginId: "qa-rule", name: "合成规则", source: "/work/qa-stable", title: "规则动画" }} registerBack={() => {}} />
      : <EpisodeSources workId="qa-work" structure={structure} files={files} sources={sources} progress={[]} artwork={null} busy={false} onPlay={id => calls.push({ command: "fixture-play", args: { id } })} />}
  </main></div>;
}
qa.__qaCalls = calls;
qa.__qaMount = (mode = "book-comic") => { slow = fail = cached = false; androidSession.invalidate("reading:"); flushSync(() => root.render(<Fixture key={++mount} mode={mode} />)); };
qa.__qaFlag = (name: string, value: boolean) => { if (name === "slow") slow = value; if (name === "fail") fail = value; };
qa.__qaResolve = () => pending.splice(0).forEach(resolve => resolve());
qa.__qaFinishBooks = () => { cached = true; for (const [id, listener] of listeners) if (listener.event === "download-jobs-updated") callbacks.get(listener.handler)?.({ event: listener.event, id, payload: [] }); };
qa.__qaUnmount = () => flushSync(() => root.render(<div>下载入口已离开</div>));
qa.__qaMount();
