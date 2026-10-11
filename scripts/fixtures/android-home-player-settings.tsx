import { useState } from "react";
import { createRoot } from "react-dom/client";
import PlaybackSettingsPanel, { type PlaybackSettingsPage } from "../../src/android/PlaybackSettingsPanel";
import ContinueWatchingArtwork from "../../src/android/ContinueWatchingArtwork";
import { androidApi, type PlaybackPreferences } from "../../src/android/api";
import { episodeArtworkApi } from "../../src/api";
import { androidSession } from "../../src/android/sessionCache";
import "../../src/android/mobile.css";

let preferences: PlaybackPreferences = { hardwareDecoding: true, hardwareDecoder: "auto-safe", videoRenderer: "auto", superResolution: 0 };
let failSave = false, failRefresh = false;
const calls: { type: string; [key: string]: unknown }[] = [];
const record = (type: string, extra: Record<string, unknown> = {}) => calls.push({ type, ...structuredClone(extra) });
const image = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><path d="M0 180L160 0 320 180" fill="white"/></svg>`)}`;
const images = { "bangumi:official-1": image("#066"), "bangumi:official-2": image("#c30") };
androidApi.playbackPreferences = async () => { record("get"); return structuredClone(preferences); };
androidApi.savePlaybackPreferences = async next => {
  record("save", { next }); await new Promise(resolve => setTimeout(resolve, 100));
  if (failSave) throw new Error("controlled save failure");
  preferences = structuredClone(next); return structuredClone(preferences);
};
episodeArtworkApi.get = async workId => { record("artwork-get", { workId }); return { anchor: "bangumi:qa", source: null, images, cachedImages: images, warnings: [], correspondence: [], sourceTitle: null }; };
episodeArtworkApi.refresh = async workId => {
  record("artwork-refresh", { workId }); if (failRefresh) throw new Error("offline fixture");
  return { anchor: "bangumi:qa", source: null, images, cachedImages: images, warnings: [], correspondence: [], sourceTitle: null };
};
episodeArtworkApi.cache = async () => { throw new Error("cached image must not download again"); };

function Fixture() {
  const [page, setPage] = useState<PlaybackSettingsPage>("main"), [mode, setMode] = useState("settings");
  const [episode, setEpisode] = useState<string | null>("bangumi:official-1");
  Object.assign(window, { __qaCalls: calls, __qaPage: setPage, __qaMode: setMode, __qaEpisode: setEpisode,
    __qaSaveFail: (value: boolean) => { failSave = value; }, __qaOffline: (value: boolean) => { failRefresh = value; androidSession.invalidate("continue-artwork:"); },
    __qaPreferences: () => structuredClone(preferences) });
  return <div className="android-app" data-theme="dark"><main className="gz-scroll">
    <h1>{mode === "settings" ? "播放设置" : "继续观看"}</h1>
    {mode === "settings" ? <PlaybackSettingsPanel page={page} onNavigate={setPage} /> : <button className="gz-continue"><div className="gz-continue-cover"><ContinueWatchingArtwork workId="qa-work" episodeKey={episode} /><span>00:17 / 24:00</span><progress value={30} max={100} /></div><strong>第二季</strong><span>文件第13集，对应官方第1集</span></button>}
  </main></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
