import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../../src/api";
import InboxPanel from "../../src/android/InboxPanel";
import Organize from "../../src/android/Organize";
import EpisodeSources from "../../src/android/EpisodeSources";
import type { AnimeWorkStructure, MatchCandidate, MediaFile, UnassignedMediaGroup } from "../../src/types";
import type { VideoSource } from "../../src/android/api";
import "../../src/android/mobile.css";
import "../../src/android/organize.css";

// Deterministic UI contract checks; no native/network/media calls or real user data.
const calls: unknown[] = [];
const file = (id: string, root: string, name: string, mediaType = "video") => ({ id, libraryRootId: root, fileName: name, path: `${root === "dav" ? "webdav" : "saf"}://${root}/${name}`, mediaType, missing: false, workId: null, parsedSeason: 1, size: 100 }) as MediaFile;
const a = file("a", "dav", "作品甲 - 01.mkv"), b = file("b", "local", "作品甲 - 01 [1080p].mkv"), sub = file("sub", "dav", "作品甲 - 01.ass", "other");
const sources = [{ id: "dav", kind: "webdav", label: "测试网盘" }, { id: "local", kind: "saf", label: "本地目录" }] as VideoSource[];
const groups = [
  { key: "a", title: "作品甲", folderPath: "webdav://dav/动画/2024/作品甲", representative: a },
  { key: "b", title: "作品乙", folderPath: "webdav://dav/动画/2024/作品乙", representative: file("pending", "dav", "01.mkv") },
  { key: "c", title: "本地作品", folderPath: "saf://local/作品", representative: b },
].map(group => ({ ...group, fileCount: 2, missingCount: 0, destination: "media", mediaType: "video", recognitionStatus: "unmatched" })) as UnassignedMediaGroup[];
const candidate = (id: string) => ({ id: "choice", mediaFileId: id, title: "作品甲", provider: "bangumi", externalId: "test-1", year: 2024, confidence: .91, matchReasons: ["标题相符"] }) as MatchCandidate;
api.listRecognitionGroupMembers = async () => ({ scope: "season", title: "作品甲", folderPath: "webdav://dav/动画/作品甲", members: [sub, a, b], linkedWorkId: null, linkedWorkTitle: null });
api.listMatchCandidates = async () => [];
api.recognizeMedia = async (id, query) => { calls.push({ type: "search", id, query }); await new Promise(resolve => setTimeout(resolve, 120)); return { mediaFileId: id, status: query === null && id !== "pending" ? "matched" : "candidate_pending", parsedTitle: "作品甲", candidates: query === null && id !== "pending" ? [] : [candidate(id)], error: null }; };
api.confirmMatch = async (id, choice, selected, scope) => { calls.push({ type: "confirm", id, choice, selected, scope }); return "work"; };
function Fixture() {
  const [mode, setMode] = useState("inbox"), [busy, setBusy] = useState(false), [opened, setOpened] = useState("");
  const run = (operation: () => Promise<void>) => { setBusy(true); void operation().finally(() => setBusy(false)); };
  return <div className="android-app" data-theme="dark"><main className="gz-scroll"><div className="gz-actions">{["inbox", "organize", "episodes"].map(value => <button className="gz-btn" key={value} onClick={() => setMode(value)}>{value}</button>)}</div>
    {mode === "inbox" ? <InboxPanel groups={groups} sources={sources} busy={busy} onRun={run} onRefresh={async () => {}} registerBack={() => {}} onOpen={(group, remaining) => setOpened(`${group.key}:${remaining?.length ?? 0}`)} />
      : mode === "organize" ? <Organize mediaId="a" initialTitle="作品甲" works={[]} busy={busy} onRun={run} onDone={async id => { calls.push({ type: "done", id }); }} />
      : <EpisodeSources structure={{ episodes: [{ provider: "bangumi", externalId: "ep1", episodeNumber: 1, sortNumber: 1, title: "第一集", episodeType: 0, localFiles: [a, b] }] } as AnimeWorkStructure} files={[a, b]} sources={sources} progress={[]} busy={busy} onPlay={id => { calls.push({ type: "play", id }); }} />}
    <output data-qa-opened>{opened}</output><button className="gz-btn" onClick={() => { (window as unknown as { __qaCalls: unknown[] }).__qaCalls = calls; }}>读取测试调用</button>
    </main><nav className="gz-tabbar" aria-label="主导航">测试导航</nav></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
