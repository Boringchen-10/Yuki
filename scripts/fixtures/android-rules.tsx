import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import RuleBrowser from "../../src/android/RuleBrowser";
import RuleSourceManager from "../../src/android/RuleSourceManager";
import { rulesApi, type RuleBinding, type RuleBindingPreview, type RulePlugin, type RuleSearch } from "../../src/android/rulesApi";
import type { PlayerSnapshot } from "../../src/android/api";
import type { WorkDetail } from "../../src/types";
import "../../src/android/mobile.css";
import "../../src/android/rules.css";

type Mode = "manager" | "work" | "trial" | "initial";
type Call = { type: string; [key: string]: unknown };
const calls: Call[] = [];
const basePlugins: RulePlugin[] = [
  { id: "fast", name: "快速规则", version: "1.0", enabled: true, origin: "https://fixture.invalid/fast.json", updatedAt: "2026-10-11" },
  { id: "slow", name: "慢速规则", version: "1.0", enabled: true, origin: null, updatedAt: "2026-10-11" },
  { id: "verify", name: "验证规则", version: "1.0", enabled: true, origin: null, updatedAt: "2026-10-11" },
  { id: "broken", name: "失败规则", version: "1.0", enabled: true, origin: null, updatedAt: "2026-10-11" },
  { id: "disabled", name: "停用规则", version: "1.0", enabled: false, origin: null, updatedAt: "2026-10-11" },
];
let plugins = structuredClone(basePlugins);
let releaseSlow: (() => void)[] = [], releasePlayback: (() => void)[] = [], releaseBind: (() => void)[] = [];
let holdPlayback = false, holdBind = false, failBind = false;
let playbackError: string | null = null;
const subjectTitle = "续季编号验收：来源从第十三集开始且名称很长的作品";
const source = "https://fixture.invalid/subject/season-two";
const work = { id: "work-qa", title: "第二季官方分集编号验收", mediaFiles: [] } as unknown as WorkDetail;
const snapshot = { error: null } as PlayerSnapshot;
const record = (type: string, values: Record<string, unknown> = {}) => calls.push({ type, ...structuredClone(values) });
const result = (items: RuleSearch["items"], extra: Partial<RuleSearch> = {}): RuleSearch => ({ items, stale: false, warning: null, verificationRequired: false, verificationUrl: null, ...extra });

rulesApi.plugins = async () => structuredClone(plugins);
rulesApi.catalog = async fresh => { record("catalog", { fresh }); return { items: [{ name: "快速规则", version: "2.0" }, { name: "新安装规则", version: "1.0", antiCrawlerEnabled: true }], stale: false }; };
rulesApi.install = async name => {
  record("install", { name });
  const found = plugins.find(plugin => plugin.name === name);
  if (found) found.version = "2.0";
  else plugins.push({ id: "installed", name, version: "1.0", enabled: true, origin: "https://fixture.invalid/new.json", updatedAt: "2026-10-11" });
  return found?.id ?? "installed";
};
rulesApi.definition = async id => { record("definition", { id }); return { name: plugins.find(plugin => plugin.id === id)?.name, version: "2.0", searchUrl: "https://fixture.invalid/search?q={keyword}" }; };
rulesApi.import = async definition => {
  record("import", { definition });
  const value = definition as { name: string; version: string };
  const found = plugins.find(plugin => plugin.name === value.name);
  if (found) found.version = value.version;
  else plugins.push({ id: `json-${plugins.length}`, name: value.name, version: value.version, enabled: true, origin: null, updatedAt: "2026-10-11" });
  return found?.id ?? plugins.at(-1)!.id;
};
rulesApi.importUrl = async url => { record("import-url", { url }); return "url-rule"; };
rulesApi.update = async id => { record("update", { id }); return id; };
rulesApi.enabled = async (id, enabled, remove = false) => {
  record("enabled", { id, enabled, remove });
  if (remove) plugins = plugins.filter(plugin => plugin.id !== id);
  else plugins.find(plugin => plugin.id === id)!.enabled = enabled;
};
rulesApi.search = async (pluginId, keyword) => {
  record("search", { pluginId, keyword });
  if (pluginId === "slow") { await new Promise<void>(resolve => releaseSlow.push(resolve)); return result([{ name: "慢源返回的结果", source: "https://fixture.invalid/slow" }]); }
  if (pluginId === "broken") throw new Error("受控测试：来源请求失败");
  if (pluginId === "verify") return result([], { verificationRequired: true, warning: "受控测试：需要网页验证", verificationUrl: "https://fixture.invalid/verification/search-redirect" });
  return result([{ name: subjectTitle, source }, ...Array.from({ length: 120 }, (_, index) => ({ name: `搜索候选 ${index + 2}`, source: `https://fixture.invalid/subject/${index + 2}` }))]);
};
rulesApi.chapters = async (pluginId, requestedSource, fresh) => {
  record("chapters", { pluginId, source: requestedSource, fresh });
  return { roads: [
    { name: "主线路", episodes: Array.from({ length: 193 }, (_, index) => ({ name: `第${index + 13}集${index === 0 ? "_长文件名_".repeat(12) : ""}`, url: `https://fixture.invalid/play/${index + 13}` })) },
    { name: "备用线路", episodes: Array.from({ length: 3 }, (_, index) => ({ name: `备用第${index + 1}集`, url: `https://fixture.invalid/backup/${index + 1}` })) },
  ], stale: false, warning: "受控测试：选集网页需要验证", verificationRequired: true, verificationUrl: "https://fixture.invalid/verification/chapters-redirect" };
};
rulesApi.verify = async (pluginId, keyword, url = null) => { record("verify", { pluginId, keyword, url }); };
rulesApi.cancelResolve = async () => { record("cancel-resolve"); };
rulesApi.bindingPreview = async input => {
  record("binding-preview", { input });
  return { token: JSON.stringify(input), title: work.title, road: input.roadIndex === 0 ? "主线路" : "备用线路", rows: input.episodeIndexes.map(index => {
    const original = input.roadIndex === 0 ? index + 13 : index + 1;
    return { index, name: `第${original}集`, originalEpisode: original, officialEpisode: original - input.episodeOffset, officialTitle: `官方第${original - input.episodeOffset}集`, existing: index === 0, conflict: false };
  }) } satisfies RuleBindingPreview;
};
rulesApi.bind = async (input, token) => {
  if (token !== JSON.stringify(input)) throw new Error("预览已过期");
  record("bind", { input, token });
  if (holdBind) await new Promise<void>(resolve => releaseBind.push(resolve));
  if (failBind) throw new Error("受控测试：保存失败");
  return input.episodeIndexes.map(index => `media-${index}`);
};
async function playback(type: string, values: Record<string, unknown>) {
  record(type, values);
  if (holdPlayback) await new Promise<void>(resolve => releasePlayback.push(resolve));
  record("playback-settled", { playbackType: type, error: playbackError });
  return playbackError ? { ...snapshot, error: { message: playbackError } } as PlayerSnapshot : snapshot;
}
rulesApi.preview = async (pluginId, requestedSource, roadIndex, episodeIndex) => playback("trial", { pluginId, source: requestedSource, roadIndex, episodeIndex });
rulesApi.play = async (input: RuleBinding) => playback("play", { input });

function Fixture() {
  const [mode, setMode] = useState<Mode>("manager"), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [saved, setSaved] = useState(0);
  const back = useRef<(() => boolean) | null>(null);
  const registerBack = useCallback((handler: (() => boolean) | null) => { back.current = handler; }, []);
  Object.assign(window, {
    __qaCalls: calls,
    __qaMode: (value: Mode) => { releaseSlow.splice(0).forEach(resolve => resolve()); releasePlayback.splice(0).forEach(resolve => resolve()); releaseBind.splice(0).forEach(resolve => resolve()); plugins = structuredClone(basePlugins); holdPlayback = false; holdBind = false; failBind = false; playbackError = null; calls.splice(0); setSaved(0); setMode(value); setRevision(value => value + 1); },
    __qaBack: () => { const handled = back.current?.() ?? false; record("back", { handled }); return handled; },
    __qaReleaseSlow: () => releaseSlow.splice(0).forEach(resolve => resolve()),
    __qaHoldPlayback: (value: boolean) => { holdPlayback = value; },
    __qaPlaybackError: (value: string | null) => { playbackError = value; },
    __qaReleasePlayback: () => releasePlayback.splice(0).forEach(resolve => resolve()),
    __qaHoldBind: (value: boolean) => { holdBind = value; },
    __qaReleaseBind: () => releaseBind.splice(0).forEach(resolve => resolve()),
    __qaFailBind: (value: boolean) => { failBind = value; },
  });
  return <div className="android-app" data-theme="dark"><main className="gz-scroll"><h2>{mode === "manager" ? "规则视频来源" : "规则搜索与剧集"}</h2><div key={`${mode}:${revision}`}>
    {mode === "manager" ? <RuleSourceManager onChanged={async () => { record("changed"); }} registerBack={registerBack} /> : <RuleBrowser work={mode === "trial" ? undefined : work} initialSource={mode === "initial" ? { pluginId: "fast", name: "快速规则", source, title: subjectTitle } : undefined} registerBack={registerBack} onBusyChange={setBusy} onSaved={async () => { setSaved(value => value + 1); record("saved"); }} />}
  </div><output hidden data-qa-busy>{String(busy)}</output><output hidden data-qa-saved>{saved}</output></main><nav className="gz-tabbar">隔离测试</nav></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
