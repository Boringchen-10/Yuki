import "./detail-unification";
import { api } from "../../src/api";
import { rulesApi } from "../../src/android/rulesApi";

// Isolated public metadata and rule responses; never call a native player or a real source.
const qa = window as any;
const originalSubject = api.getExploreSubject, originalWork = api.getWork;
const saved = new Set<string>();
api.getExploreSubject = async id => {
  const value = await originalSubject(id);
  return saved.has(id) ? { ...value, inLibrary: true, localWorkId: `saved-${id}` } : value;
};
api.saveExploreSubject = async input => {
  qa.__calls.push({ kind: "save", input });
  if (qa.__delaySave) await new Promise<void>(resolve => { qa.__finishSave = resolve; });
  if (qa.__failSave) throw new Error("受控保存失败");
  saved.add(input.externalId);
  return `saved-${input.externalId}`;
};
api.getWork = async id => id.startsWith("saved-") ? { ...await originalWork("local"), id, favorite: false, status: "in_progress", mediaFiles: [] } : originalWork(id);
rulesApi.plugins = async () => [{ id: "qa-rule", name: "隔离规则", version: "1", enabled: true, origin: null, updatedAt: "2026-10-16" }];
rulesApi.search = async (pluginId, keyword) => {
  qa.__calls.push({ kind: "search", pluginId, keyword });
  if (qa.__delaySearch) await new Promise<void>(resolve => { qa.__finishSearch = resolve; });
  return { items: [{ name: keyword, source: "qa-subject" }], stale: false, warning: null, verificationRequired: false, verificationUrl: null };
};
rulesApi.chapters = async () => ({ roads: [{ name: "测试线路", episodes: [13, 14].map(number => ({ name: `第${number}集`, url: `https://qa.invalid/${number}` })) }], stale: false, warning: null, verificationRequired: false, verificationUrl: null });
rulesApi.play = async input => {
  qa.__calls.push({ kind: "play", input });
  return { sessionId: "qa-session", mediaFileId: "qa-media", status: "preparing", positionMs: 0, durationMs: null, revision: 1, seekable: false, rate: 1, audioTracks: [], subtitleTracks: [], audioTrackId: null, subtitleTrackId: null, subtitleOffsetMs: 0, error: null };
};
rulesApi.cancelResolve = async () => { qa.__calls.push({ kind: "cancel" }); };
