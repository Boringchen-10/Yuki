import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api, episodeArtworkApi } from "../../src/api";
import InboxPanel from "../../src/android/InboxPanel";
import Organize from "../../src/android/Organize";
import EpisodeSources from "../../src/android/EpisodeSources";
import SourceImports from "../../src/android/SourceImports";
import type { AnimeWorkStructure, MatchCandidate, MediaFile, RecognitionKind, UnassignedMediaGroup } from "../../src/types";
import { androidApi, type VideoSource, type SourceImportTask } from "../../src/android/api";
import "../../src/android/mobile.css";
import "../../src/android/organize.css";

// Deterministic UI contract checks; no native/network/media calls or real user data.
const calls: unknown[] = [];
const still = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#43756b"/></svg>')}`;
const artwork = { anchor: "bangumi:test", source: null, images: { "bangumi:ep1": still }, cachedImages: {}, warnings: [], sourceTitle: "测试剧照" };
episodeArtworkApi.get = async () => artwork; episodeArtworkApi.refresh = async () => artwork;
episodeArtworkApi.cache = async (workId, episodeKey) => { calls.push({ type: "cache", workId, episodeKey }); return still; };
const task = { id: "background", sourceIds: ["dav"], stage: "recognizing", total: 3, done: 1, matched: 1, pending: 0, errors: 0, currentDirectory: "动画/2024/这是用于检查窄屏换行的一个较长作品文件夹/第一季", currentTitle: "作品甲", message: null } as SourceImportTask;
androidApi.importSources = async (sourceIds, scan, mediaIds) => { calls.push({ type: "enqueue", sourceIds, scan, mediaIds }); return { id: "background" } as SourceImportTask; };
const file = (id: string, root: string, name: string, mediaType = "video") => ({ id, libraryRootId: root, fileName: name, path: `${root === "dav" ? "webdav" : "saf"}://${root}/${name}`, mediaType, missing: false, workId: null, parsedSeason: 1, size: 100 }) as MediaFile;
const a = file("a", "dav", "作品甲 - 01.mkv"), b = file("b", "local", "作品甲 - 01 [1080p].mkv"), sub = file("sub", "dav", "作品甲 - 01.ass", "other");
const sources = [{ id: "dav", kind: "webdav", label: "测试网盘" }, { id: "local", kind: "saf", label: "本地目录" }] as VideoSource[];
const groups = [
  { key: "a", title: "作品甲", folderPath: "webdav://dav/动画/2024/作品甲", representative: a },
  { key: "b", title: "作品乙", folderPath: "webdav://dav/动画/2024/作品乙", representative: file("pending", "dav", "01.mkv") },
  { key: "c", title: "本地作品", folderPath: "saf://local/作品", representative: b },
].map(group => ({ ...group, fileCount: 2, missingCount: 0, destination: "media", mediaType: "video", recognitionStatus: "unmatched" })) as UnassignedMediaGroup[];
const candidate = (id: string, kind: RecognitionKind = "anime", season = 1) => ({ id: "choice", mediaFileId: id, title: kind === "movie" ? "调音师" : kind === "tv" ? `示例剧集 · 第 ${season} 季` : "作品甲", originalTitle: kind === "movie" ? "Andhadhun" : "Example", provider: kind === "anime" ? "bangumi" : "tmdb", externalId: kind === "movie" ? "movie/42" : kind === "tv" ? `tv/42/season/${season}` : "test-1", subjectType: kind === "anime" ? "tv" : kind, season: kind === "tv" ? season : null, year: 2018, coverUrl: still, description: "这是用于核对作品身份的完整简介。" + "长简介默认摘要，完整内容可按需展开。".repeat(30), score: 8.2, airDate: "2018-10-05", confidence: .91, matchReasons: ["标题相符"] }) as MatchCandidate;
let searchMode = "normal";
Object.assign(window, { __qaSearchMode: (value: string) => { searchMode = value; } });
api.listRecognitionGroupMembers = async () => ({ scope: "season", title: "作品甲", folderPath: "webdav://dav/动画/作品甲", members: [sub, a, b], linkedWorkId: null, linkedWorkTitle: null });
api.listMatchCandidates = async () => [];
api.recognizeMedia = async (id, query, kind = "anime", season) => { calls.push({ type: "search", id, query, kind, season }); await new Promise(resolve => setTimeout(resolve, 120)); if (searchMode === "error") throw new Error("受控网络失败，请重试"); return { mediaFileId: id, status: query === null && id !== "pending" ? "matched" : searchMode === "empty" ? "unmatched" : "candidate_pending", parsedTitle: kind === "movie" ? "调音师" : "作品甲", candidates: searchMode === "empty" || query === null && id !== "pending" ? [] : [candidate(id, kind, season)], error: null }; };
api.confirmMatch = async (id, choice, selected, scope) => { calls.push({ type: "confirm", id, choice, selected, scope }); return "work"; };
function Fixture() {
  const [mode, setMode] = useState("inbox"), [busy, setBusy] = useState(false), [opened, setOpened] = useState("");
  const run = (operation: () => Promise<void>) => { setBusy(true); void operation().finally(() => setBusy(false)); };
  return <div className="android-app" data-theme="dark"><main className="gz-scroll"><div className="gz-actions">{["inbox", "organize", "episodes", "tasks"].map(value => <button className="gz-btn" key={value} onClick={() => setMode(value)}>{value}</button>)}</div>
    {mode === "inbox" ? <InboxPanel groups={groups} sources={sources} busy={busy} onRun={run} onRefresh={async () => {}} registerBack={() => {}} onOpen={(group, remaining) => setOpened(`${group.key}:${remaining?.length ?? 0}`)} />
      : mode === "organize" ? <Organize mediaId="a" initialTitle="作品甲" works={[]} busy={busy} onRun={run} onDone={async id => { calls.push({ type: "done", id }); }} />
      : mode === "episodes" ? <EpisodeSources workId="work" structure={{ episodes: [{ provider: "bangumi", externalId: "ep1", episodeNumber: 1, sortNumber: 1, title: "第一集", episodeType: 0, localFiles: [a, b] }] } as AnimeWorkStructure} files={[a, b]} sources={sources} progress={[]} busy={busy} onPlay={id => { calls.push({ type: "play", id }); }} />
      : <SourceImports tasks={[task]} sources={sources} onChange={async () => {}} />}
    <output data-qa-opened>{opened}</output><button className="gz-btn" onClick={() => { (window as unknown as { __qaCalls: unknown[] }).__qaCalls = calls; }}>读取测试调用</button>
    </main><nav className="gz-tabbar" aria-label="主导航">测试导航</nav></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
