import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api, correctionApi } from "../../src/api";
import BatchEpisodeMatcher from "../../src/android/BatchEpisodeMatcher";
import type { AnimeWorkStructure, MediaFile, WorkDetail } from "../../src/types";
import type { CorrectionInput, CorrectionPreview } from "../../src/recognitionPreferences";
import "../../src/android/mobile.css";
import "../../src/android/organize.css";

const files = [...Array.from({ length: 12 }, (_, index) => index + 13), 13, 26].map((number, index) => ({ id: `f${index}`, workId: "w", libraryRootId: "dav", mediaType: "video", missing: false, fileName: `作品第二季 - ${number}${index === 12 ? " [另一版本]" : ""}.mkv`, path: `webdav://dav/作品第二季/${number}-${index}.mkv`, parsedEpisodeStart: number, parsedEpisode: String(number) })) as MediaFile[];
const structure = { bangumiId: "qa", episodes: Array.from({ length: 12 }, (_, index) => ({ provider: "bangumi", externalId: `ep${index + 1}`, episodeNumber: index + 1, sortNumber: index + 1, episodeType: 0, title: `官方第${index + 1}集`, localFiles: index === 1 ? [files[1]] : [] })) } as AnimeWorkStructure;
const work = { id: "w", title: "第二季编号对应验收", type: "video", mediaFiles: files } as WorkDetail;
const calls: { type: string; input?: CorrectionInput }[] = [];
(window as unknown as { __qaCalls: typeof calls }).__qaCalls = calls;
function assessment(input: CorrectionInput): CorrectionPreview {
  return { token: JSON.stringify(input), title: work.title, warnings: [], rows: input.mediaFileIds.map((id, index) => {
    const file = files.find(file => file.id === id)!;
    const episode = input.mode === "sequence" ? input.startEpisode + index : file.parsedEpisodeStart! - (input.episodeOffset ?? 0);
    const matched = episode >= 1 && episode <= 12;
    return { id, fileName: file.fileName, fromTitle: work.title, episode, oldEpisode: file.parsedEpisode, parsedEpisode: file.parsedEpisode, officialTitle: matched ? `官方第${episode}集` : null, officialEpisodeId: matched ? `ep${episode}` : null, episodeType: 0, eligible: episode >= 0, reliable: matched && id !== "f1", issues: id === "f1" ? [{ code: "manual_existing", message: "已有人工关联", action: "review" }] : [] };
  }) };
}
correctionApi.inspect = async input => { calls.push({ type: "inspect", input }); return assessment(input); };
correctionApi.preview = async input => { calls.push({ type: "preview", input }); return assessment(input); };
correctionApi.apply = async (input, token) => { if (token !== JSON.stringify(input)) throw new Error("预览过期"); calls.push({ type: "apply", input }); return work.id; };
api.refreshWorkMetadata = async () => structure;
function Fixture() {
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  return <div className="android-app" data-theme="dark"><main className="gz-scroll"><h2>批量匹配剧集</h2><BatchEpisodeMatcher work={work} structure={structure} onBusyChange={setBusy} onSaved={async () => setSaved(true)} /><output data-qa-saved>{saved ? "saved" : "pending"}</output><output data-qa-busy>{String(busy)}</output></main><nav className="gz-tabbar">测试导航</nav></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
