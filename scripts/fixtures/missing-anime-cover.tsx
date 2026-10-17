import "./detail-unification";
import { api } from "../../src/api";
import { androidSession } from "../../src/android/sessionCache";

const qa = window as any;
const poster = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#247596"/><text x="60" y="300" fill="white" font-size="32">Blue Box QA</text></svg>')}`;
const original = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#9a5425"/></svg>')}`;
const work: any = { id: "blue-box", title: "青之箱 第二季", originalTitle: "アオのハコ Season 2", type: "video", category: "anime", coverPath: null, coverFallbackPath: poster, status: "in_progress", favorite: true, rating: 9, notes: "保留个人记录", tags: [], description: "合成封面回归", createdAt: "2026-10-17", updatedAt: "2026-10-17", mediaFiles: [], mediaCount: 0, metadata: { provider: "bangumi", externalId: "548156" }, fieldLocks: [], candidates: [], subtitleLinks: [] };
const subject: any = { provider: "bangumi", externalId: "548156", title: work.title, originalTitle: work.originalTitle, coverUrl: poster, aliases: [], description: work.description, subjectType: "tv", genres: [], year: 2026, score: null, rank: null, ratingCount: 0, collectionCount: 0, inLibrary: true, favorite: true, localWorkId: work.id, localStatus: work.status, fetchedAt: "2026-10-17", stale: false };
api.listWorks = async () => [structuredClone(work)];
api.getWork = async () => structuredClone(work);
api.animePopular = async () => ({ items: [structuredClone(subject)], page: 1, pageSize: 24, totalPages: 1, hasMore: false, stale: false });
api.getExploreSubject = async () => structuredClone(subject);
api.getAnimeWorkStructure = async () => ({ workId: work.id, provider: "bangumi", bangumiId: "548156", cached: true, seasons: [], episodes: [], staff: [], characters: [], unmatchedFiles: [], warnings: [] });
qa.__coverPoster = poster;
qa.__coverOriginal = original;
qa.__coverMode = (mode: string) => {
  work.coverPath = mode === "missing" ? null : mode === "broken" ? "http://cover.test/missing.jpg" : original;
  work.coverFallbackPath = mode === "no-cache" ? null : poster;
  androidSession.invalidate("");
  location.hash = "#/library";
};
