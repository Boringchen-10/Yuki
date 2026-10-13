import { useState } from "react";
import { createRoot } from "react-dom/client";
import ExplorePanel from "../../src/android/ExplorePanel";
import { api } from "../../src/api";
import { comicExploreApi, novelExploreApi, type ComicItem } from "../../src/comicExplore";
import type { ExploreSubject } from "../../src/types";
import "../../src/android/mobile.css";

const qa = window as any;
const calls: any[] = [], pending: (() => void)[] = [];
const modes = new Map<string, string>();
const item = (prefix: string, id: number): ComicItem => ({ pathWord: `${prefix}-${id}`, title: `${prefix} ${id}`, coverUrl: null, authors: [], tags: [], summary: "", status: "", updatedAt: "", latestChapter: "", localWorkId: null, favorite: false });
const subject = (id: number): ExploreSubject => ({ provider: "bangumi", externalId: String(id), title: `热门 ${id}`, originalTitle: null, aliases: [], description: "", coverUrl: null, bannerUrl: null, year: null, month: null, airDate: null, broadcast: null, subjectType: "tv", genres: [], score: null, rank: null, ratingCount: 0, collectionCount: 0, inLibrary: false, favorite: false, localWorkId: null, localStatus: null, fetchedAt: "", stale: false });
async function controlled<T>(scope: string, cursor: number, value: T): Promise<T> {
  const mode = modes.get(scope);
  if (mode === "fail" && cursor > 0) throw new Error("controlled offline");
  if (mode === "delay") return new Promise(resolve => pending.push(() => resolve(value)));
  return value;
}
api.animePopular = async page => {
  calls.push({ scope: "popular", page });
  const count = page < 3 ? 24 : 1;
  const items = Array.from({ length: count }, (_, index) => subject(page === 2 && index === 0 ? 24 : (page - 1) * 24 + index + 1));
  return controlled("popular", page - 1, { items, page, hasMore: page < 3, stale: false } as any);
};
api.weeklyCalendar = async () => ({ days: [], stale: false, fetchedAt: "" } as any);
api.searchExplore = async query => { calls.push({ scope: "animeSearch", query }); return [subject(100)]; };
comicExploreApi.home = async () => ({ stale: false, sections: ["recommended", "newArrivals", "completed"].map(section => ({ section, period: null, audience: null, items: Array.from({ length: 4 }, (_, index) => ({ item: item(section, index), popularity: null, rankPopularity: null, rank: null })), total: 60, supportsPaging: true })) } as any);
comicExploreApi.section = async input => {
  calls.push({ scope: "section", ...input });
  const items = Array.from({ length: Math.min(24, 60 - input.offset) }, (_, index) => ({ item: item(input.section, input.offset === 24 && index === 0 ? 23 : input.offset + index), popularity: null, rankPopularity: null, rank: null }));
  return controlled("section", input.offset, { items, total: 60, offset: input.offset, limit: 24, hasMore: input.offset + 24 < 60, stale: false });
};
novelExploreApi.themes = async () => [{ pathWord: "slow", name: "慢题材" }, { pathWord: "fast", name: "快题材" }];
for (const [kind, source] of [["comic", comicExploreApi], ["novel", novelExploreApi]] as const) {
  source.list = async input => {
    const scope = input.query ? `${kind}Search` : "novelList";
    calls.push({ scope, ...input });
    const prefix = input.query || input.theme || "小说";
    const total = 60;
    const offset = (input.page - 1) * 24;
    const items = modes.get(scope) === "empty" && input.page > 1 ? [] : Array.from({ length: Math.min(24, total - offset) }, (_, index) => item(prefix, input.page === 2 && index === 0 ? 23 : offset + index));
    return controlled(input.theme === "slow" ? "slowTheme" : scope, offset, { items, total, page: input.page, stale: false });
  };
}
function Fixture() {
  const [active, setActive] = useState(true);
  qa.__qaActive = setActive;
  return <div className="android-app"><div className="gz-scroll"><ExplorePanel active={active} onToast={message => calls.push({ scope: "toast", message })} /></div></div>;
}
qa.__qaCalls = calls;
qa.__qaMode = (scope: string, mode: string) => modes.set(scope, mode);
qa.__qaRelease = () => pending.splice(0).forEach(resolve => resolve());
createRoot(document.getElementById("root")!).render(<Fixture />);
