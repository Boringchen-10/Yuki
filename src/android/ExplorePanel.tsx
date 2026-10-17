import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { startAndroidTransition as startExploreTransition, startPanelTransition, startDetailTabTransition } from "./viewTransition";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, Clock, Download, Heart, HeartCrack, MessageCircle, Play, RefreshCw, Search, Star, Users, X } from "lucide-react";
import { api } from "../api";
import { androidApi } from "./api";
import type { AnimeEpisodeMetadata, AnimeSeasonOption, AnimeWorkStructure, ExploreSubject, WeeklyCalendar, WeeklyCalendarDay, WorkStatus } from "../types";
import { appendComicPage, comicExploreApi, novelExploreApi, type ComicDetail, type ComicFeedEntry, type ComicHome, type ComicItem, type ComicSection, type ComicSectionPage, type ComicSectionQuery, type ComicTheme, type RankPeriod } from "../comicExplore";
import { type SourceEntry } from "../bookContent";
import BookReader from "./BookReader";
import BookDescription from "./BookDescription";
import ComicComments from "./ComicComments";
import ImmediateBookFavorite from "./ImmediateBookFavorite";
import BookDetailMenu from "./BookDetailMenu";
import {useBookShelfState} from "./bookShelfState";
import {peekExploreTag,takeExploreTag,EXPLORE_TAG_EVENT,type ExploreTagTarget} from "./exploreTagNavigation";
import TagDiscovery from "./TagDiscovery";
import { AnimeDetailHeader, BookDetailHeader } from "./DetailHeaders";
import EpisodeSources from "./EpisodeSources";
import PlaySourceSheet from "./PlaySourceSheet";
import { useEpisodeArtwork } from "./useEpisodeArtwork";
import BangumiCommentFeed from "./BangumiCommentFeed";
import { useBangumiComments } from "./useBangumiComments";
import AnimeCharacters from "./AnimeCharacters";
import AnimeRelated from "./AnimeRelated";
import AnimeStaff from "./AnimeStaff";
import { onExploreSubjectRequest } from "./exploreSubjectNav";
import { ComicCover } from "../components/ComicCover";
import AnimeCover from "./AnimeCover";
import OnlineChapters from "./OnlineChapters";
import LoadingIndicator from "./LoadingIndicator";
import { androidSession, READING_NETWORK_CHANGED } from "./sessionCache";
import { BANGUMI_NETWORK_CHANGED } from "../bangumiNetwork";

type ExploreTab = "anime" | "comic" | "novel";
type ExploreView = "feed" | "schedule" | "section";
type LoadState = "loading" | "ready" | "error";
type PopularSnapshot = { items: ExploreSubject[]; page: number; hasMore: boolean };
type SubjectDetailTab = "episodes" | "overview" | "comments" | "characters" | "related" | "staff";

const pic = (path: string | null | undefined) => path
  ? (/^(https?:|asset:|data:|blob:)/.test(path) ? path : convertFileSrc(path))
  : undefined;
const cover = (subject: ExploreSubject) => pic(subject.coverUrl);
const subjectStub = (externalId: string, extra: Partial<ExploreSubject> = {}): ExploreSubject => ({
  provider: "bangumi", externalId, title: "", originalTitle: null, aliases: [], description: "",
  coverUrl: null, bannerUrl: null, year: null, month: null, airDate: null, broadcast: null,
  subjectType: "tv", genres: [], score: null, rank: null, ratingCount: 0, collectionCount: 0,
  inLibrary: false, favorite: false, localWorkId: null, localStatus: null, fetchedAt: "", stale: false, ...extra,
});
const relatedSubject = (season: AnimeSeasonOption): ExploreSubject => subjectStub(season.externalId, {
  title: season.title, originalTitle: season.originalTitle, coverUrl: season.coverUrl,
  localWorkId: season.localWorkId, inLibrary: !!season.localWorkId,
});
const score = (value: number | null) => value == null ? "暂无评分" : value.toFixed(1);

const subjectTypeLabels: Record<ExploreSubject["subjectType"], string> = { tv: "TV", web: "WEB", movie: "剧场版", ova: "OVA" };
const weekdayNumber = (date = new Date()) => (date.getDay() === 0 ? 7 : date.getDay());
const SEASONS = [
  { label: "冬季", month: 1 },
  { label: "春季", month: 4 },
  { label: "夏季", month: 7 },
  { label: "秋季", month: 10 },
] as const;
const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const courStartMonth = (date = new Date()) => {
  const month = date.getMonth() + 1;
  return month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
};
const seasonLabelOf = (year: number, month: number) => `${year} ${SEASONS.find(season => season.month === month)?.label ?? ""}`;
const subjectWeekday = (subject: ExploreSubject): number | null => {
  const raw = (subject.broadcast?.replace(/^R\//, "").split("/")[0] || subject.airDate || "").trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getDay();
  return day === 0 ? 7 : day;
};
const groupByWeekday = (items: ExploreSubject[]): WeeklyCalendarDay[] =>
  [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, label: WEEKDAY_LABELS[weekday] ?? "", items: items.filter(item => subjectWeekday(item) === weekday) }));
const curatedTags = (items: ExploreSubject[], limit = 24) => {
  const counts = new Map<string, number>();
  for (const item of items) for (const genre of item.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
};
let animeExploreCache: { trending: ExploreSubject[]; calendar: WeeklyCalendar | null; rankingPage: number; rankingHasMore: boolean; popularError: string } | null = null;
let comicHomeCache: ComicHome | null = null;
const comicSectionCache = new Map<string, ComicSectionPage>();
const bookExplorePages = new Map<string, ComicPageState>();

const COMIC_SECTION_LABELS: Record<ComicSection, string> = { recommended: "推荐", ranking: "排行榜", hotUpdates: "热门更新", newArrivals: "全新上架", completed: "已完结" };
const RANK_PERIODS: RankPeriod[] = ["day", "week", "month"];
const RANK_PERIOD_LABELS: Record<RankPeriod, string> = { day: "日榜", week: "周榜", month: "月榜" };
const formatPopularity = (value: number | null) => value == null ? "" : value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value);
const makeSectionQuery = (section: ComicSection, period: RankPeriod | null, offset: number, limit = 24): ComicSectionQuery => {
  if (section === "ranking") return { section, period: period ?? "day", offset, limit };
  if (section === "recommended" || section === "newArrivals" || section === "completed") return { section, offset, limit };
  return { section: "recommended", offset, limit };
};

type ComicPageState = { page: number; total: number; items: ComicItem[]; stale: boolean };

const FOLLOW_STATUS: { id: WorkStatus | "none"; label: string }[] = [
  { id: "none", label: "未追" },
  { id: "in_progress", label: "在看" },
  { id: "planned", label: "想看" },
  { id: "paused", label: "搁置" },
  { id: "completed", label: "看过" },
  { id: "dropped", label: "抛弃" },
];
const SUBJECT_TABS: { id: SubjectDetailTab; label: string }[] = [
  { id: "episodes", label: "剧集" },
  { id: "overview", label: "概览" },
  { id: "comments", label: "吐槽" },
  { id: "characters", label: "角色" },
  { id: "related", label: "关联" },
  { id: "staff", label: "制作人员" },
];
const statusIdOf = (subject: ExploreSubject): WorkStatus | "none" => subject.inLibrary ? (subject.localStatus ?? "planned") : "none";
const StatusIcon = ({ id, size = 16 }: { id: WorkStatus | "none"; size?: number }) =>
  id === "none" ? <Heart size={size} />
    : id === "in_progress" ? <Heart size={size} fill="currentColor" />
      : id === "planned" ? <Star size={size} />
        : id === "paused" ? <Clock size={size} />
          : id === "completed" ? <Check size={size} />
            : <HeartCrack size={size} />;

const exploreCoverName = (id: string) => `gz-explore-cover-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export default function ExplorePanel({ onToast, onLibraryChanged, onOpenWork, registerBack, active = true }: { onToast: (message: string) => void; onLibraryChanged?: () => void; onOpenWork?: (id: string) => void; registerBack?: (handler: (() => boolean) | null) => void; active?: boolean }) {
  const activeRef=useRef(active);activeRef.current=active;
  const [tab, setTab] = useState<ExploreTab>(()=>peekExploreTag()?.kind??"anime");
  const [tagTarget,setTagTarget]=useState<ExploreTagTarget|null>(()=>peekExploreTag());
  const shelfEntries=useBookShelfState(state=>state.entries);
  const favoritePreview=useRef(new Map<string,{favorite:boolean;localWorkId?:string|null}>());
  useEffect(()=>{void useBookShelfState.getState().load().catch(reason=>onToast(String(reason)));},[]);
  useEffect(()=>{
    const receive=()=>{if(!active)return;const target=takeExploreTag();if(!target)return;bookDetailRequest.current++;subjectRequest.current++;setComicDetail(null);setSubject(null);setBookSelecting(false);setView("feed");setTab(target.kind);setTagTarget(target);};
    window.addEventListener(EXPLORE_TAG_EVENT,receive);receive();return()=>window.removeEventListener(EXPLORE_TAG_EVENT,receive);
  },[active]);
  const [view, setView] = useState<ExploreView>("feed");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState("");

  const [animeResults, setAnimeResults] = useState<ExploreSubject[]>([]);
  const [comicResults, setComicResults] = useState<ComicItem[]>([]);
  const [novelResults, setNovelResults] = useState<ComicItem[]>([]);

  const [trending, setTrending] = useState<ExploreSubject[]>(() => animeExploreCache?.trending ?? []);
  const [calendar, setCalendar] = useState<WeeklyCalendar | null>(() => animeExploreCache?.calendar ?? null);
  const [animeState, setAnimeState] = useState<LoadState>(() => animeExploreCache ? "ready" : "loading");
  const [animeError, setAnimeError] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [rankingPage, setRankingPage] = useState(() => animeExploreCache?.rankingPage ?? 1);
  const [rankingHasMore, setRankingHasMore] = useState(() => animeExploreCache?.rankingHasMore ?? true);
  const [rankingLoadingMore, setRankingLoadingMore] = useState(false);
  const [rankingMoreError, setRankingMoreError] = useState("");
  const [scheduleDay, setScheduleDay] = useState(weekdayNumber);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const [currentCour] = useState(() => ({ year: new Date().getFullYear(), month: courStartMonth() }));
  const [scheduleYear, setScheduleYear] = useState(currentCour.year);
  const [scheduleMonth, setScheduleMonth] = useState(currentCour.month);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [seasonDays, setSeasonDays] = useState<WeeklyCalendarDay[] | null>(null);
  const [seasonState, setSeasonState] = useState<LoadState>("ready");
  const isCurrentCour = scheduleYear === currentCour.year && scheduleMonth === currentCour.month;

  const [comicHome, setComicHome] = useState<ComicHome | null>(() => comicHomeCache);
  const [comicHomeState, setComicHomeState] = useState<LoadState>(() => comicHomeCache ? "ready" : "loading");
  const [comicHomeError, setComicHomeError] = useState("");
  const [comicSection, setComicSection] = useState<{ section: ComicSection; period: RankPeriod | null } | null>(null);
  const [comicSectionPage, setComicSectionPage] = useState<ComicSectionPage | null>(null);
  const [comicSectionState, setComicSectionState] = useState<LoadState>("ready");
  const [comicSectionError, setComicSectionError] = useState("");
  const [comicSectionMore, setComicSectionMore] = useState(false);
  const [comicSectionMoreError, setComicSectionMoreError] = useState("");
  const [novelThemes, setNovelThemes] = useState<ComicTheme[]>([]);
  const [novelTheme, setNovelTheme] = useState("");
  const [novels, setNovels] = useState<ComicItem[]>([]);
  const [novelState, setNovelState] = useState<LoadState>("loading");
  const [novelError, setNovelError] = useState("");
  const [bookPage, setBookPage] = useState(1);
  const [bookTotal, setBookTotal] = useState(0);
  const [bookLoadingMore, setBookLoadingMore] = useState(false);
  const [bookMoreError, setBookMoreError] = useState("");

  const [subject, setSubject] = useState<ExploreSubject | null>(null);
  const [subjectTab, setSubjectTab] = useState<SubjectDetailTab>("overview");
  const [descExpanded, setDescExpanded] = useState(false);
  const [statusSheet, setStatusSheet] = useState(false);
  const [playSource, setPlaySource] = useState<{ episode?: AnimeEpisodeMetadata } | null>(null);
  const [saving, setSaving] = useState(false);
  const [comicDetail, setComicDetail] = useState<ComicDetail | null>(null);
  const [comicDetailKind, setComicDetailKind] = useState<"comic" | "novel">("comic");
  const currentBook = useRef("");
  currentBook.current = comicDetail ? `${comicDetailKind}:${comicDetail.item.pathWord}` : "";
  const [bookDetailState, setBookDetailState] = useState<LoadState>("ready");
  const [bookSelecting, setBookSelecting] = useState(false);
  const [readerGroup, setReaderGroup] = useState("");
  const [comicCommentsOpen, setComicCommentsOpen] = useState(false);
  const [readerEntry, setReaderEntry] = useState<SourceEntry | null>(null);
  const [structure, setStructure] = useState<AnimeWorkStructure | null>(null);
  const [structureState, setStructureState] = useState<LoadState>("ready");
  const [structureAttempt, setStructureAttempt] = useState(0);
  const structureRetry = useRef(0);
  const comments = useBangumiComments(subject?.externalId ?? null, active && subjectTab === "comments");
  const artworkSignature = active && subjectTab === "episodes" && structure?.bangumiId === subject?.externalId ? structure?.episodes.map(episode => `${episode.provider}:${episode.externalId}`).join(",") ?? "" : "";
  const subjectArtwork = useEpisodeArtwork(subject?.localWorkId ?? undefined, artworkSignature, subject?.externalId);

  const hotSentinelRef = useRef<HTMLDivElement>(null);
  const searchSentinelRef = useRef<HTMLDivElement>(null);
  const searchRequest = useRef(0);
  const searchPending = useRef(false);
  const rankingPending = useRef(false);
  const bookRequest = useRef(0);
  const bookPending = useRef(false);
  const comicSectionPending = useRef(false);
  const bookSentinelRef = useRef<HTMLDivElement>(null);
  const comicSectionSentinelRef = useRef<HTMLDivElement>(null);
  const comicSectionReqRef = useRef(0);
  const daysRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const animeLoadRef = useRef(0);
  const readingLoadRef = useRef(0);
  const popularSnapshotRef = useRef<PopularSnapshot | null>(null);
  const [popularLoading, setPopularLoading] = useState(false);
  const exploreCoverRef = useRef<HTMLElement | null>(null);
  const clickedCoverRef = useRef<HTMLElement | null>(null);
  const exploreScroll = useRef(0);
  const exploreDetailId = useRef<string | null>(null);
  const bookDetailRequest = useRef(0);
  const subjectRequest = useRef(0);
  const subjectCommentsSentinelRef = useRef<HTMLDivElement>(null);
  const subjectContentRef = useRef<HTMLDivElement>(null);
  const explorePanel = useRef<HTMLDivElement>(null);
  const exploreBody = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const backHandler = useRef<() => boolean>(() => false);
  const runExploreMorph = useCallback((id: string, direction: "forward" | "back", commit: () => void) => {
    document.querySelectorAll<HTMLElement>("[data-explore-cover-id]").forEach(node => node.style.removeProperty("view-transition-name"));
    const source = direction === "forward"
      ? clickedCoverRef.current?.dataset.exploreCoverId === id ? clickedCoverRef.current : document.querySelector<HTMLElement>(`[data-explore-cover-id="${CSS.escape(id)}"]`)
      : exploreCoverRef.current;
    if (!source) { commit(); return; }
    const scroll = source.closest<HTMLElement>(".gz-scroll");
    if (direction === "forward") exploreScroll.current = scroll?.scrollTop ?? 0;
    source.style.setProperty("view-transition-name", exploreCoverName(id));
    const root = document.documentElement;
    root.dataset.trans = "morph"; root.dataset.nav = direction;
    const update = () => { flushSync(commit); if (scroll) scroll.scrollTop = direction === "forward" ? 0 : exploreScroll.current; document.querySelector<HTMLElement>(`[data-explore-cover-id="${CSS.escape(id)}"]`)?.style.setProperty("view-transition-name", exploreCoverName(id)); };
    const transition = startExploreTransition(update);
    if (!transition) {
      update();
      window.setTimeout(() => { source.style.removeProperty("view-transition-name"); delete root.dataset.trans; delete root.dataset.nav; }, 420);
      return;
    }
    const cleanup = () => { if (!transition.isCurrent()) return; source.style.removeProperty("view-transition-name"); document.querySelectorAll<HTMLElement>("[data-explore-cover-id]").forEach(node => node.style.removeProperty("view-transition-name")); delete root.dataset.trans; delete root.dataset.nav; };
    void transition.finished.then(cleanup, cleanup);
  }, []);
  backHandler.current = () => {
    if (playSource) { setPlaySource(null); return true; }
    if (comicCommentsOpen) { setComicCommentsOpen(false); return true; }
    if (statusSheet) { setStatusSheet(false); return true; }
    if (subject) { subjectRequest.current++; const id = exploreDetailId.current ?? subject.externalId; runExploreMorph(id, "back", () => setSubject(null)); return true; }
    if (readerEntry) { setReaderEntry(null); return true; }
    if (bookSelecting) { setBookSelecting(false); return true; }
    if (comicDetail) { bookDetailRequest.current++; const id = comicDetail.item.pathWord; runExploreMorph(id, "back", () => setComicDetail(null)); return true; }
    if (seasonOpen) { setSeasonOpen(false); return true; }
    if (view === "section") { startPanelTransition("back", exploreBody.current, () => { setComicSection(null); setView("feed"); }); return true; }
    if (view === "schedule") { startPanelTransition("back", exploreBody.current, () => setView("feed")); return true; }
    if(tagTarget){setTagTarget(null);return true;}
    return false;
  };
  useEffect(() => {
    if (!registerBack || !active) return;
    registerBack(() => backHandler.current());
    return () => registerBack(null);
  }, [registerBack, active]);
  useEffect(() => () => { bookDetailRequest.current++; subjectRequest.current++; animeLoadRef.current++; readingLoadRef.current++; comicSectionReqRef.current++; bookRequest.current++; searchRequest.current++; }, []);

  const loadAnime = useCallback(async (force = false) => {
    if (!force && animeExploreCache) {
      setTrending(animeExploreCache.trending);
      setCalendar(animeExploreCache.calendar);
      setRankingPage(animeExploreCache.rankingPage); setRankingHasMore(animeExploreCache.rankingHasMore);
      popularSnapshotRef.current = { items: animeExploreCache.trending, page: animeExploreCache.rankingPage, hasMore: animeExploreCache.rankingHasMore };
      setAnimeError(animeExploreCache.popularError); setPopularLoading(false);
      setAnimeState("ready");
      return;
    }
    const loadId = ++animeLoadRef.current;
    rankingPending.current = false; setRankingLoadingMore(false); setRankingMoreError("");
    popularSnapshotRef.current = null;
    const active = () => animeLoadRef.current === loadId;
    setAnimeState("loading"); setAnimeError(""); setPopularLoading(true);
    let rankingError: unknown = null;
    let calendarError: unknown = null;
    const rankingTask = api.animePopular(1, force).then(value => {
      if (active()) {
        popularSnapshotRef.current = { items: value.items, page: 1, hasMore: value.hasMore };
        setTrending(value.items); setRankingPage(1); setRankingHasMore(value.hasMore); setPopularLoading(false); setAnimeState("ready");
      }
      return value;
    }).catch(reason => { rankingError = reason; if (active()) { setPopularLoading(false); setAnimeError(String(reason)); } return null; });
    const calendarTask = api.weeklyCalendar().then(value => {
      if (active()) setCalendar(value);
      return value;
    }).catch(reason => { calendarError = reason; return null; });
    const [ranking, calendar] = await Promise.all([rankingTask, calendarTask]);
    if (!active()) return;
    // Pagination can update this ref while the independent calendar request finishes.
    const popularSnapshot = popularSnapshotRef.current as PopularSnapshot | null;
    const nextTrending = popularSnapshot?.items ?? [];
    if (ranking || calendar) {
      setTrending(nextTrending);
      setCalendar(calendar);
      const nextRankingPage = popularSnapshot?.page ?? 1;
      const nextRankingHasMore = popularSnapshot?.hasMore ?? false;
      setRankingPage(nextRankingPage); setRankingHasMore(nextRankingHasMore);
      const popularError = rankingError ? String(rankingError) : "";
      setAnimeError(popularError);
      animeExploreCache = { trending: nextTrending, calendar, rankingPage: nextRankingPage, rankingHasMore: nextRankingHasMore, popularError };
      setAnimeState("ready");
    } else {
      setAnimeError(String(rankingError ?? calendarError ?? "Bangumi 数据读取失败。"));
      setAnimeState("error");
    }
  }, []);

  const loadMoreRanking = useCallback(async () => {
    if (rankingPending.current || !rankingHasMore || popularLoading) return;
    const loadId = animeLoadRef.current;
    rankingPending.current = true;
    setRankingLoadingMore(true); setRankingMoreError("");
    try {
      const page = (popularSnapshotRef.current?.page ?? rankingPage) + 1;
      const next = await api.animePopular(page);
      if (loadId !== animeLoadRef.current) return;
      if (next.hasMore && !next.items.length) throw new Error("来源未返回下一页，请稍后重试。");
      const hasMore = next.hasMore;
      const items = [...new Map([...(popularSnapshotRef.current?.items ?? []), ...next.items].map(item => [item.externalId, item])).values()];
      popularSnapshotRef.current = { items, page, hasMore };
      setTrending(items);
      setRankingPage(page); setRankingHasMore(hasMore);
      animeExploreCache = animeExploreCache ? { ...animeExploreCache, trending: items, rankingPage: page, rankingHasMore: hasMore } : animeExploreCache;
    } catch (reason) { if (loadId === animeLoadRef.current) setRankingMoreError(String(reason)); }
    finally { if (loadId === animeLoadRef.current) { rankingPending.current = false; setRankingLoadingMore(false); } }
  }, [rankingHasMore, popularLoading, rankingPage]);

  const loadBooks = useCallback(async (nextTheme: string, nextPage = 1, append = false) => {
    if (append && bookPending.current) return;
    const generation = readingLoadRef.current;
    const request = append ? bookRequest.current : ++bookRequest.current;
    const key = `novel:${nextTheme}`;
    const cached = bookExplorePages.get(key);
    if (append && cached && nextPage <= cached.page) return;
    if (!append) { bookPending.current = false; setBookLoadingMore(false); }
    setBookMoreError("");
    if (!append && nextPage === 1 && cached) {
      setNovels(cached.items); setNovelState("ready"); setNovelError("");
      setBookPage(cached.page); setBookTotal(cached.total);
      return;
    }
    bookPending.current = true;
    if (append) setBookLoadingMore(true);
    else { setNovels([]); setBookPage(0); setBookTotal(0); setNovelState("loading"); setNovelError(""); }
    try {
      const page = await novelExploreApi.list({ query: "", theme: nextTheme, top: "", sort: "popular", page: nextPage });
      if (generation !== readingLoadRef.current || request !== bookRequest.current) return;
      if (page.page !== nextPage || !page.items.length && (page.page - 1) * 24 < page.total) throw new Error("来源未返回当前页，请稍后重试。");
      const merged = append && cached ? appendComicPage(cached, page) : page;
      bookExplorePages.set(key, merged);
      setNovels(merged.items); setNovelState("ready");
      setBookPage(page.page); setBookTotal(merged.total);
    } catch (reason) {
      if (generation !== readingLoadRef.current || request !== bookRequest.current) return;
      if (append) setBookMoreError(String(reason));
      else { setNovelError(String(reason)); setNovelState("error"); }
    } finally { if (generation === readingLoadRef.current && request === bookRequest.current) { bookPending.current = false; setBookLoadingMore(false); } }
  }, []);

  const loadComicHome = useCallback(async (force = false) => {
    const generation = readingLoadRef.current;
    if (!force && comicHomeCache) { setComicHome(comicHomeCache); setComicHomeState("ready"); return; }
    setComicHomeState("loading"); setComicHomeError("");
    try {
      const value = await comicExploreApi.home(force);
      if (generation !== readingLoadRef.current) return;
      comicHomeCache = value; setComicHome(value); setComicHomeState("ready");
    } catch (reason) { if (generation === readingLoadRef.current) { setComicHomeError(String(reason)); setComicHomeState("error"); } }
  }, []);

  const openComicSection = useCallback((section: ComicSection, period: RankPeriod | null = null, force = false) => {
    const key = `${section}:${period ?? ""}`;
    const request = ++comicSectionReqRef.current;
    startPanelTransition("forward", exploreBody.current, () => { setComicSection({ section, period }); setView("section"); });
    comicSectionPending.current = false;
    setComicSectionError(""); setComicSectionMore(false); setComicSectionMoreError("");
    const cached = comicSectionCache.get(key);
    if (cached && !force) { setComicSectionPage(cached); setComicSectionState("ready"); return; }
    setComicSectionPage(null); setComicSectionState("loading");
    void comicExploreApi.section(makeSectionQuery(section, period, 0), force).then(page => {
      if (comicSectionReqRef.current !== request) return;
      comicSectionCache.set(key, page); setComicSectionPage(page); setComicSectionState("ready");
    }).catch(reason => {
      if (comicSectionReqRef.current !== request) return;
      setComicSectionError(String(reason)); setComicSectionState("error");
    });
  }, []);

  const loadMoreComicSection = useCallback(async () => {
    if (!comicSection || !comicSectionPage || comicSectionPending.current || !comicSectionPage.hasMore || comicSectionState !== "ready") return;
    const request = comicSectionReqRef.current;
    comicSectionPending.current = true;
    setComicSectionMore(true); setComicSectionMoreError("");
    try {
      const key = `${comicSection.section}:${comicSection.period ?? ""}`;
      const current = comicSectionCache.get(key) ?? comicSectionPage;
      const offset = current.offset + current.limit;
      const next = await comicExploreApi.section(makeSectionQuery(comicSection.section, comicSection.period, offset));
      if (comicSectionReqRef.current !== request) return;
      if (next.offset !== offset || next.limit <= 0 || next.hasMore && !next.items.length) throw new Error("来源未返回下一页，请稍后重试。");
      const merged = { ...next, items: [...new Map([...current.items, ...next.items].map(entry => [entry.item.pathWord, entry])).values()] };
      comicSectionCache.set(key, merged);
      setComicSectionPage(merged);
    } catch (reason) { if (comicSectionReqRef.current === request) setComicSectionMoreError(String(reason)); }
    finally { if (comicSectionReqRef.current === request) { comicSectionPending.current = false; setComicSectionMore(false); } }
  }, [comicSection, comicSectionPage, comicSectionState]);

  useEffect(() => { if(!tagTarget)void loadAnime(); }, [loadAnime,!!tagTarget]);
  useEffect(() => {
    const changed = () => {
      animeExploreCache = null; androidSession.invalidate("bangumi:"); androidSession.invalidate("local:structure:"); void loadAnime(true);
      if (tab === "anime" && searchTerm !== null) clearSearch();
      if (subject) {
        const request = ++subjectRequest.current;
        void androidSession.load(`bangumi:subject:${subject.externalId}`, () => api.getExploreSubject(subject.externalId)).then(value => { if (request === subjectRequest.current) setSubject(value); }).catch(() => {});
      }
    };
    window.addEventListener(BANGUMI_NETWORK_CHANGED, changed);
    return () => window.removeEventListener(BANGUMI_NETWORK_CHANGED, changed);
  }, [loadAnime, subject, tab, searchTerm]);
  useEffect(() => {
    const changed = () => {
      const generation = ++readingLoadRef.current;
      comicHomeCache = null; comicSectionCache.clear(); bookExplorePages.clear();
      if (tab !== "anime" && searchTerm !== null) clearSearch();
      setNovelThemes([]); setBookLoadingMore(false);
      void loadComicHome(true);
      if (tab === "novel") {
        void androidSession.load("reading:novel-themes", () => novelExploreApi.themes()).then(value => { if (generation === readingLoadRef.current) setNovelThemes(value); }).catch(() => {});
        void loadBooks(novelTheme);
      }
      if (comicSection) openComicSection(comicSection.section, comicSection.period, true);
      if (comicDetail) void openBook(comicDetail.item, comicDetailKind);
    };
    window.addEventListener(READING_NETWORK_CHANGED, changed);
    return () => window.removeEventListener(READING_NETWORK_CHANGED, changed);
  }, [tab, novelTheme, comicSection, comicDetail, comicDetailKind, loadComicHome, loadBooks, openComicSection, searchTerm]);
  useEffect(() => {
    if (isCurrentCour) { setSeasonDays(null); setSeasonState("ready"); return; }
    let cancelled = false;
    setSeasonState("loading");
    androidSession.load(`bangumi:season:${scheduleYear}:${scheduleMonth}`, () => api.exploreOverview(scheduleYear, scheduleMonth))
      .then(overview => { if (!cancelled) { setSeasonDays(groupByWeekday(overview.seasonal)); setSeasonState("ready"); } })
      .catch(() => { if (!cancelled) { setSeasonDays(null); setSeasonState("error"); } });
    return () => { cancelled = true; };
  }, [isCurrentCour, scheduleYear, scheduleMonth]);
  useEffect(() => {
    if (tab !== "comic" || tagTarget) return;
    void loadComicHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, !!tagTarget]);

  useEffect(() => {
    if (tab !== "novel" || tagTarget) return;
    const generation = readingLoadRef.current;
    if (!novelThemes.length) void androidSession.load("reading:novel-themes", () => novelExploreApi.themes()).then(value => { if (generation === readingLoadRef.current) setNovelThemes(value); }).catch(() => {});
    void loadBooks(novelTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, !!tagTarget]);

  useEffect(() => {
    const node = bookSentinelRef.current;
    if (!node || !active || subject || comicDetail || view !== "feed" || searchTerm !== null || tab !== "novel" || novelState !== "ready" || bookMoreError || bookLoadingMore || bookPage * 24 >= bookTotal) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadBooks(novelTheme, bookPage + 1, true);
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, subject, comicDetail, view, searchTerm, novelState, bookMoreError, bookLoadingMore, bookPage, bookTotal, loadBooks, novelTheme, tab]);

  useEffect(() => {
    const node = comicSectionSentinelRef.current;
    if (!node || !active || subject || comicDetail || view !== "section" || !comicSection || comicSectionMore || comicSectionMoreError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreComicSection();
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, subject, comicDetail, comicSection, comicSectionMore, comicSectionMoreError, loadMoreComicSection, view]);

  useEffect(() => {
    const node = hotSentinelRef.current;
    if (!node || !active || subject || comicDetail || view !== "feed" || searchTerm !== null || tab !== "anime" || !rankingHasMore || rankingLoadingMore || rankingMoreError || animeError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreRanking();
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, subject, comicDetail, view, searchTerm, loadMoreRanking, rankingHasMore, rankingLoadingMore, rankingMoreError, animeError, tab, trending.length]);

  useEffect(() => {
    const workId = subject?.localWorkId;
    if (!subject) { setStructure(null); setStructureState("ready"); return; }
    if (!workId && (subjectTab === "overview" || subjectTab === "comments")) return;
    let cancelled = false;
    const key = workId ? `local:structure:${workId}` : `bangumi:structure:${subject.externalId}:${subjectTab}`;
    const force = structureRetry.current !== structureAttempt;
    structureRetry.current = structureAttempt;
    if (force) androidSession.invalidate(key);
    const cached = androidSession.peek<AnimeWorkStructure>(key);
    const apply = (value:AnimeWorkStructure) => setStructure(previous=>{
      if(workId || !previous || previous.bangumiId!==value.bangumiId)return value;
      return {...previous,warnings:value.warnings,...(subjectTab==="episodes"?{episodes:value.episodes}:subjectTab==="related"?{seasons:value.seasons}:subjectTab==="characters"?{characters:value.characters}:{staff:value.staff})};
    });
    if(cached)apply(cached);else setStructure(previous=>previous?.bangumiId===subject.externalId?previous:null);
    setStructureState(cached ? "ready" : "loading");
    androidSession.load(key, () => workId ? api.getAnimeWorkStructure(workId) : api.getBangumiSubjectStructure(subject.externalId,subjectTab,force))
      .then(value => { if (!cancelled) { apply(value); setStructureState("ready"); } })
      .catch(() => { if (!cancelled) setStructureState("error"); });
    return () => { cancelled = true; };
  }, [subject?.externalId, subject?.localWorkId, subjectTab, structureAttempt]);

  useEffect(() => {
    exploreCoverRef.current = subject || comicDetail
      ? document.querySelector<HTMLElement>(`[data-explore-cover-id="${CSS.escape(subject?.externalId ?? comicDetail?.item.pathWord ?? "")}"]`)
      : null;
  });

  const openSubjectRef = useRef<(item: ExploreSubject) => Promise<void>>(async () => {});
  const openSubject = async (item: ExploreSubject) => {
    setPlaySource(null);
    if (item.localWorkId && onOpenWork) { onOpenWork(item.localWorkId); return; }
    const request = ++subjectRequest.current;
    exploreDetailId.current = item.externalId;
    const subjectKey = `bangumi:subject:${item.externalId}`;
    await new Promise<void>(resolve => runExploreMorph(item.externalId, "forward", () => { setSubject(androidSession.peek<ExploreSubject>(subjectKey) ?? item); setSubjectTab("episodes"); setDescExpanded(false); setSearchOpen(false); setTagsOpen(false); resolve(); }));
    if (request !== subjectRequest.current) return;
    try { const value = await androidSession.load(subjectKey, () => api.getExploreSubject(item.externalId)); if (request !== subjectRequest.current || !activeRef.current) return; if(value.localWorkId && onOpenWork){setSubject(null);onOpenWork(value.localWorkId);return;}setSubject(value); } catch { /* keep list data */ }
  };
  openSubjectRef.current = openSubject;

  useEffect(() => onExploreSubjectRequest(externalId => { void openSubjectRef.current(subjectStub(externalId)); }), []);

  const openBook = async (item: ComicItem, kind: "comic" | "novel") => {
    if(item.localWorkId && !useBookShelfState.getState().entries[item.localWorkId]?.hidden && onOpenWork){onOpenWork(item.localWorkId);return;}
    const request = ++bookDetailRequest.current;
    const detailKey = `reading:detail:${kind}:${item.pathWord}`;
    const cachedDetail = androidSession.peek<ComicDetail>(detailKey);
    const initialize = () => {
      setComicDetailKind(kind); setComicDetail(cachedDetail ?? { item, aliases: [], chapterCount: null, stale: false });
      setBookDetailState(cachedDetail ? "ready" : "loading"); setBookSelecting(false); setReaderEntry(null); setComicCommentsOpen(false);
    };
    if (comicDetail?.item.pathWord === item.pathWord) initialize();
    else await new Promise<void>(resolve => runExploreMorph(item.pathWord, "forward", () => { initialize(); resolve(); }));
    if (request !== bookDetailRequest.current) return;
    try {
      const detail = await androidSession.load(detailKey, () => kind === "comic" ? comicExploreApi.detail(item.pathWord) : novelExploreApi.detail(item.pathWord), bookDetailState === "error");
      if (request !== bookDetailRequest.current || !activeRef.current) return;
      if(detail.item.localWorkId && !useBookShelfState.getState().entries[detail.item.localWorkId]?.hidden && onOpenWork){setComicDetail(null);onOpenWork(detail.item.localWorkId);return;}
      const override=favoritePreview.current.get(`${kind}:${item.pathWord}`);
      setComicDetail(override?{...detail,item:{...detail.item,...override}}:detail); setBookDetailState("ready");
      if(detail.item.localWorkId)void useBookShelfState.getState().event(detail.item.localWorkId,"browse").catch(()=>{});
    } catch (reason) {
      if (request !== bookDetailRequest.current) return;
      setBookDetailState("error");
      onToast(String(reason));
    }
  };

  useEffect(() => {
    const node = subjectCommentsSentinelRef.current;
    if (!node || !active || subjectTab !== "comments" || comments.state !== "ready" || comments.loadingMore || !comments.hasMore || comments.moreError) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void comments.loadMore(); }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, subjectTab, comments.state, comments.loadingMore, comments.hasMore, comments.moreError, comments.nextOffset, comments.subjectId, comments.loadMore]);

  const switchTab = (next: ExploreTab) => {
    if (next === tab) return;
    const order: ExploreTab[] = ["anime", "comic", "novel"];
    startPanelTransition(order.indexOf(next) < order.indexOf(tab) ? "back" : "forward", exploreBody.current, () => {
      setTab(next);
      clearSearch(); setSearchOpen(false);
    });
  };

  const loadSearch = useCallback(async (term: string, nextPage = 1, append = false) => {
    if (append && searchPending.current) return;
    const request = append ? searchRequest.current : ++searchRequest.current;
    searchPending.current = true;
    setSearching(true); setSearchError(""); setSearchTerm(term);
    if (!append) { setSearchPage(0); setSearchTotal(0); setAnimeResults([]); setComicResults([]); setNovelResults([]); }
    try {
      if (tab === "anime") {
        const items = await api.searchExplore(term);
        if (request === searchRequest.current) setAnimeResults(items);
      } else {
        const page = await (tab === "comic" ? comicExploreApi : novelExploreApi).list({ query: term, theme: "", top: "", sort: "popular", page: nextPage });
        if (request !== searchRequest.current) return;
        if (page.page !== nextPage || !page.items.length && (page.page - 1) * 24 < page.total) throw new Error("来源未返回当前页，请稍后重试。");
        const setResults = tab === "comic" ? setComicResults : setNovelResults;
        setResults(previous => append ? [...new Map([...previous, ...page.items].map(item => [item.pathWord, item])).values()] : page.items);
        setSearchPage(page.page); setSearchTotal(page.total);
      }
    } catch (reason) { if (request === searchRequest.current) setSearchError(String(reason)); }
    finally { if (request === searchRequest.current) { searchPending.current = false; setSearching(false); } }
  }, [tab]);

  useEffect(() => {
    const node = searchSentinelRef.current;
    if (!node || !active || subject || comicDetail || view !== "feed" || searchTerm === null || tab === "anime" || searching || searchError || searchPage * 24 >= searchTotal) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadSearch(searchTerm, searchPage + 1, true);
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, subject, comicDetail, view, searchTerm, tab, searching, searchError, searchPage, searchTotal, loadSearch]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) { onToast("请输入要搜索的名称"); return; }
    void loadSearch(term);
  };

  const clearSearch = () => {
    searchRequest.current++; searchPending.current = false;
    setSearchTerm(null); setQuery(""); setSearching(false); setSearchError(""); setSearchPage(0); setSearchTotal(0);
    setAnimeResults([]); setComicResults([]); setNovelResults([]);
  };

  const saveStatus = async (status: WorkStatus | "none") => {
    setStatusSheet(false);
    if (!subject) return;
    if (status === "none") { onToast("移出媒体库暂不支持，请选择追番状态"); return; }
    setSaving(true);
    try {
      await api.saveExploreSubject({ externalId: subject.externalId, status, favorite: subject.favorite });
      const updated = await api.getExploreSubject(subject.externalId);
      androidSession.set(`bangumi:subject:${subject.externalId}`, updated); setSubject(updated);
      onLibraryChanged?.();
      onToast("追番状态已更新");
      if(updated.localWorkId && onOpenWork && activeRef.current){setSubject(null);onOpenWork(updated.localWorkId);}
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  const saveBook = async (item: ComicItem, kind: "comic" | "novel") => {
    setSaving(true);
    try {
      const workId = kind === "comic" ? await comicExploreApi.save(item.pathWord, item.favorite) : await novelExploreApi.save(item.pathWord, item.favorite);
      await useBookShelfState.getState().event(workId,"restore");
      const cached=androidSession.peek<ComicDetail>(`reading:detail:${kind}:${item.pathWord}`);
      if(cached)androidSession.set(`reading:detail:${kind}:${item.pathWord}`,{...cached,item:{...cached.item,localWorkId:workId}});
      setComicDetail(previous => previous && currentBook.current === `${kind}:${item.pathWord}`
        ? { ...previous, item: { ...previous.item, localWorkId: workId } }
        : previous);
      onLibraryChanged?.();
      onToast("已加入书架");
    } catch (reason) { onToast(String(reason)); }
    finally { setSaving(false); }
  };

  function previewFavorite(item:ComicItem,kind:"comic"|"novel",next:boolean){
    const key=`${kind}:${item.pathWord}`;
    favoritePreview.current.set(key,{...favoritePreview.current.get(key),favorite:next});
    setComicDetail(previous=>previous&&currentBook.current===key?{...previous,item:{...previous.item,favorite:next}}:previous);
  }
  async function favoriteBook(item:ComicItem,kind:"comic"|"novel",next:boolean){
    const id=item.localWorkId??await (kind==="comic"?comicExploreApi:novelExploreApi).save(item.pathWord,next);
    await api.setFavorite(id,next);
    favoritePreview.current.set(`${kind}:${item.pathWord}`,{localWorkId:id,favorite:next});
    setComicDetail(previous=>previous&&currentBook.current===`${kind}:${item.pathWord}`?{...previous,item:{...previous.item,localWorkId:id,favorite:next}}:previous);
    const cached=androidSession.peek<ComicDetail>(`reading:detail:${kind}:${item.pathWord}`);if(cached)androidSession.set(`reading:detail:${kind}:${item.pathWord}`,{...cached,item:{...cached.item,localWorkId:id,favorite:next}});
    onLibraryChanged?.();onToast(next?"已加入收藏":"已取消收藏");
  }
  function exploreTag(kind:ExploreTab,tag:string){bookDetailRequest.current++;subjectRequest.current++;setComicDetail(null);setSubject(null);setBookSelecting(false);setTab(kind);setView("feed");setTagTarget({kind,tag});}

  const playEpisode = async (mediaFileId: string) => {
    try { await androidApi.play(mediaFileId); }
    catch (reason) { onToast(String(reason)); }
  };

  const resolvePlayWork = async () => {
    if (!subject) throw new Error("作品资料暂不可用，请重试。");
    const current = subject;
    const id = current.localWorkId ?? await api.saveExploreSubject({ externalId: current.externalId, status: current.localStatus ?? "planned", favorite: current.favorite, forPlayback: true });
    const work = await api.getWork(id);
    const updated = { ...current, localWorkId: id, inLibrary: true, localStatus: work.status, favorite: work.favorite };
    androidSession.set(`bangumi:subject:${current.externalId}`, updated);
    setSubject(previous => previous?.externalId === current.externalId ? updated : previous);
    onLibraryChanged?.();
    return work;
  };

  const selectDay = (next: number) => { setSlideDir(next >= scheduleDay ? "right" : "left"); setScheduleDay(next); };

  const animeCard = (item: ExploreSubject) => <button className="gz-cover" key={item.externalId} onClick={() => void openSubject(item)}>
    <span className="gz-explore-poster" data-explore-cover-id={item.externalId}>
      <AnimeCover id={item.externalId} url={cover(item)} />
    </span>
    <span className="gz-cover-label">{item.title}</span>
  </button>;

  const comicCard = (item: ComicItem, kind: "comic" | "novel" = "comic") => <button className="gz-cover" key={item.pathWord} onClick={() => void openBook(item, kind)}>
    <span className={`gz-explore-poster${kind === "novel" ? " is-novel" : ""}`} data-explore-cover-id={item.pathWord}>
      <ComicCover item={item} />
    </span>
    <span className="gz-cover-label">{item.title}</span>
  </button>;

  const comicHomeCard = (entry: ComicFeedEntry, showRank = false) => {
    const item = entry.item;
    const sub = [formatPopularity(entry.popularity ?? entry.rankPopularity), item.authors[0]].filter(Boolean).join(" ");
    return <button className="gz-comic-card" key={item.pathWord} onClick={() => void openBook(item, "comic")}>
      <span className="gz-comic-poster" data-explore-cover-id={item.pathWord}>
        <ComicCover item={item} />
        {showRank && entry.rank != null && <span className="gz-comic-rank">{entry.rank}</span>}
      </span>
      <strong className="gz-comic-title">{item.title}</strong>
      {sub && <span className="gz-comic-sub">{sub}</span>}
    </button>;
  };

  const scheduleRow = (item: ExploreSubject) => <button className="gz-sched-row" key={item.externalId} onClick={() => void openSubject(item)}>
    <span className="gz-sched-cover"><AnimeCover id={item.externalId} url={cover(item)} /></span>
    <span className="gz-sched-body">
      <strong>{item.title}</strong>
      <span className="gz-meta">{[subjectTypeLabels[item.subjectType], ...item.genres.slice(0, 3)].filter(Boolean).join(" · ")}</span>
    </span>
    {item.score != null && <span className="gz-sched-score"><Star size={12} />{score(item.score)}</span>}
  </button>;

  const today = weekdayNumber();
  const popularItems = trending;
  const hotItems = popularItems;
  const tagChips = useMemo(() => curatedTags(popularItems), [popularItems]);
  const dailyItems = calendar?.days.find(day => day.weekday === today)?.items ?? [];
  const seasonLabel = seasonLabelOf(scheduleYear, scheduleMonth);
  const seasonYears = Array.from({ length: 10 }, (_, index) => currentCour.year - index);
  const scheduleDays = isCurrentCour ? calendar?.days ?? null : seasonDays;
  const scheduleItems = scheduleDays?.find(day => day.weekday === scheduleDay)?.items ?? [];
  const subjectStatusId = subject ? statusIdOf(subject) : "none";
  const comicSections = useMemo(() => {
    const sections = comicHome?.sections ?? [];
    return {
      recommended: sections.find(section => section.section === "recommended") ?? null,
      ranking: sections.filter(section => section.section === "ranking"),
      hotUpdates: sections.find(section => section.section === "hotUpdates") ?? null,
      newArrivals: sections.find(section => section.section === "newArrivals") ?? null,
      completed: sections.find(section => section.section === "completed") ?? null,
    };
  }, [comicHome]);

  useLayoutEffect(() => {
    const container = daysRef.current;
    if (!container || !scheduleDays) { setPill(null); return; }
    const index = scheduleDays.findIndex(day => day.weekday === scheduleDay);
    const button = container.querySelectorAll<HTMLElement>("button")[index];
    if (!button) { setPill(null); return; }
    setPill({ left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight });
  }, [scheduleDay, scheduleDays, view, isCurrentCour]);

  const scheduleView = <div className="gz-schedule">
    <div className="gz-sched-head">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => startPanelTransition("back", exploreBody.current, () => setView("feed"))}><ArrowLeft size={20} /></button>
      <h2>放送时间表</h2>
      <button className="gz-season-btn" aria-haspopup="dialog" aria-expanded={seasonOpen} onClick={() => setSeasonOpen(true)}>{seasonLabel}<ChevronDown size={14} /></button>
    </div>
    {isCurrentCour && !calendar ? <LoadingIndicator label="正在读取放送时间表…" compact />
      : !isCurrentCour && seasonState === "loading" ? <LoadingIndicator label="正在读取该季度番组…" compact />
        : !isCurrentCour && seasonState === "error" ? <div className="gz-error" role="alert"><span>该季度数据读取失败。</span></div>
          : <>
            {scheduleDays && <div className={`gz-sched-days${pill ? " has-pill" : ""}`} role="tablist" aria-label="星期" ref={daysRef}>
              <span className="gz-sched-pill" ref={pillRef} aria-hidden="true" style={pill ? { transform: `translate(${pill.left}px, ${pill.top}px)`, width: `${pill.width}px`, height: `${pill.height}px` } : undefined} />
              {scheduleDays.map(day => <button key={day.weekday} role="tab" aria-selected={scheduleDay === day.weekday} className={scheduleDay === day.weekday ? "active" : ""} onClick={() => selectDay(day.weekday)}>
                <span className="gz-sched-day-label">{isCurrentCour && day.weekday === today ? "今天" : day.label}</span>
                <span className="gz-sched-day-num">{day.items.length}</span>
              </button>)}
            </div>}
            {scheduleItems.length ? <div className={`gz-sched-list is-${slideDir}`} key={scheduleDay}>{scheduleItems.map(scheduleRow)}</div> : <div className="gz-empty"><BookOpen size={26} /><h2>这天没有番组</h2><p>{isCurrentCour ? "换一周中的其他日子看看。" : "换个季度或换一天看看。"}</p></div>}
          </>}
  </div>;

  const subjectView = subject && <div className="gz-subject">
    <div className="gz-subject-topbar">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => backHandler.current()}><ArrowLeft size={20} /></button>
    </div>
    <AnimeDetailHeader title={subject.title} originalTitle={subject.originalTitle} poster={<span className="gz-poster" data-explore-cover-id={subject.externalId}><AnimeCover id={subject.externalId} url={cover(subject)} /></span>} backdrop={cover(subject) ? <AnimeCover id={subject.externalId} url={cover(subject)} /> : undefined} date={subject.airDate} rating={subject.score} votes={subject.ratingCount} rank={subject.rank} episodes={structure?.bangumiId === subject.externalId ? structure.episodes.length : null}>
          <button type="button" className="gz-status-pill" aria-haspopup="dialog" aria-expanded={statusSheet} disabled={saving} onClick={() => setStatusSheet(true)}>
            <StatusIcon id={subjectStatusId} /><span>{FOLLOW_STATUS.find(row => row.id === subjectStatusId)?.label}</span>
          </button>
    </AnimeDetailHeader>
    <div className="gz-detail-tabs" role="tablist" aria-label="条目详情分类">
      {SUBJECT_TABS.map(tab => <button type="button" role="tab" key={tab.id} aria-selected={subjectTab === tab.id} className={subjectTab === tab.id ? "active" : ""} onClick={() => { if (tab.id === subjectTab) return; const from = SUBJECT_TABS.findIndex(item => item.id === subjectTab); const to = SUBJECT_TABS.findIndex(item => item.id === tab.id); startDetailTabTransition(to < from ? "back" : "forward", subjectContentRef.current, () => setSubjectTab(tab.id)); }}>{tab.label}</button>)}
    </div>
    <div className="gz-detail-content" ref={subjectContentRef}>
    {subjectTab === "episodes" && <section className="gz-section">
      {structureState === "loading" ? <LoadingIndicator label="正在读取剧集…" compact />
          : structure && structure.episodes.length ? <>
            <div className="gz-section-head"><h2>剧集</h2><span className="gz-meta">{structure.episodes.length} 集</span><button type="button" className="gz-iconbtn" aria-label="更新分集剧照" disabled={subjectArtwork.refreshing} onClick={()=>void subjectArtwork.refresh()}><RefreshCw size={16}/></button></div>
            <EpisodeSources subjectId={subject.externalId} structure={structure} files={structure.episodes.flatMap(episode=>episode.localFiles)} sources={[]} progress={[]} artwork={subjectArtwork.artwork} busy={false} onPlay={id=>void playEpisode(id)} onOpenPlaySource={episode=>setPlaySource({episode})}/>
            {subjectArtwork.warning && <p className="gz-meta">剧照暂未更新，可稍后重试。</p>}
          </> : structureState === "error" ? <div className="gz-error" role="alert"><span>Bangumi 分集资料读取失败。</span><button className="gz-iconbtn" aria-label="重试分集资料" onClick={() => setStructureAttempt(value=>value+1)}><RefreshCw size={16} /></button></div> : <div className="gz-empty"><BookOpen size={26} /><h2>暂无剧集资料</h2><p>Bangumi 未提供该条目的分集资料。</p></div>}
    </section>}
    {subjectTab === "overview" && <>
      <section className="gz-section">
        <div className="gz-section-head"><h2>简介</h2></div>
        <p className={`gz-description gz-clamp${descExpanded ? "" : " is-clamped"}`}>{subject.description || "Bangumi 未提供简介。"}</p>
        {subject.description.trim().length > 90 && <button className="gz-link" onClick={() => setDescExpanded(value => !value)}>{descExpanded ? "收起简介" : "展开简介"}</button>}
      </section>
      <section className="gz-section">
        <div className="gz-section-head"><h2>标签</h2>{subject.genres.length > 0 && <span className="gz-meta">{subject.genres.length} 个</span>}</div>
        {subject.genres.length ? <div className="gz-tag-grid">{subject.genres.map(genre => <button type="button" className="gz-tag" key={genre} onClick={()=>exploreTag("anime",genre)}>{genre}</button>)}</div> : <p className="gz-meta">暂无标签。</p>}
      </section>
      <section className="gz-section">
        <div className="gz-section-head"><h2>资料</h2></div>
        <div className="gz-subject-stats">
          <div className="gz-subject-stat"><span>类型:</span><strong>{subjectTypeLabels[subject.subjectType]}</strong></div>
          <div className="gz-subject-stat"><span>放送开始:</span><strong>{subject.airDate ?? "未提供"}</strong></div>
          <div className="gz-subject-stat"><span>收藏人数:</span><strong>{subject.collectionCount}</strong></div>
          <div className="gz-subject-stat"><span>数据来源:</span><strong>Bangumi</strong></div>
        </div>
      </section>
    </>}
    {subjectTab === "comments" && <section className="gz-section">
      <div className="gz-section-head"><h2>吐槽</h2><span className="gz-meta">Bangumi 条目评论</span></div>
      {(comments.state === "loading" || comments.state === "idle") && !comments.items.length ? <LoadingIndicator label="正在读取吐槽…" compact />
        : comments.state === "error" && !comments.items.length ? <div className="gz-error" role="alert"><span>吐槽读取失败，请检查 Bangumi 网络设置。</span><button className="gz-iconbtn" aria-label="重试吐槽" onClick={() => void comments.retry()}><RefreshCw size={16} /></button></div>
          : comments.items.length ? <><BangumiCommentFeed items={comments.items} />{comments.state === "loading" ? <LoadingIndicator label="正在更新吐槽…" compact /> : comments.state === "error" ? <div className="gz-error" role="alert"><span>刷新失败，保留已有内容。</span><button className="gz-iconbtn" aria-label="重试刷新吐槽" onClick={() => void comments.retry()}><RefreshCw size={16} /></button></div> : comments.moreError ? <div className="gz-error" role="alert"><span>更多吐槽读取失败，请重试。</span><button className="gz-iconbtn" aria-label="重试更多吐槽" onClick={() => void comments.retryMore()}><RefreshCw size={16} /></button></div> : comments.hasMore && <><div className="gz-sentinel" ref={subjectCommentsSentinelRef} aria-hidden="true" />{comments.loadingMore && <LoadingIndicator label="正在加载更多吐槽…" compact />}</>}</>
          : <div className="gz-empty"><MessageCircle size={26} /><h2>暂无吐槽</h2><p>Bangumi 尚未提供该条目的公开吐槽。</p></div>}
    </section>}
    {subjectTab === "characters" && <section className="gz-section">
      {structureState === "loading" ? <LoadingIndicator label="正在读取角色资料…" compact /> : structure && structure.characters.length
        ? <><div className="gz-section-head"><h2>角色</h2><span className="gz-meta">{structure.characters.length} 位</span></div><AnimeCharacters characters={structure.characters} /></>
        : <><div className="gz-section-head"><h2>角色</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>{structureState === "error" ? "角色资料读取失败" : "暂无角色资料"}</h2><p>{structureState === "error" ? "请检查网络设置后重试。" : "Bangumi 尚未提供该条目的角色与声优。"}</p></div></>}
    </section>}
    {subjectTab === "related" && <section className="gz-section">
      {structureState === "loading" ? <LoadingIndicator label="正在读取关联作品…" compact /> : structure && structure.seasons.length
        ? <><div className="gz-section-head"><h2>关联</h2><span className="gz-meta">{structure.seasons.length} 部</span></div><AnimeRelated seasons={structure.seasons} onOpen={season => void openSubject(relatedSubject(season))} /></>
        : <><div className="gz-section-head"><h2>关联</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>{structureState === "error" ? "关联资料读取失败" : "暂无关联作品"}</h2><p>{structureState === "error" ? "请检查网络设置后重试。" : "Bangumi 尚未提供该条目的关联作品。"}</p></div></>}
    </section>}
    {subjectTab === "staff" && <section className="gz-section">
      {structureState === "loading" ? <LoadingIndicator label="正在读取制作人员…" compact /> : structure && structure.staff.length
        ? <><div className="gz-section-head"><h2>制作人员</h2><span className="gz-meta">{structure.staff.length} 位</span></div><AnimeStaff staff={structure.staff} /></>
        : <><div className="gz-section-head"><h2>制作人员</h2><span className="gz-meta">Bangumi 条目资料</span></div><div className="gz-empty"><Users size={26} /><h2>{structureState === "error" ? "制作人员读取失败" : "暂无制作人员资料"}</h2><p>{structureState === "error" ? "请检查网络设置后重试。" : "Bangumi 尚未提供该条目的制作人员。"}</p></div></>}
    </section>}
    </div>
    {statusSheet && <div className="gz-scrim" onClick={() => setStatusSheet(false)}><section className="gz-sheet gz-status-sheet" role="dialog" aria-modal="true" aria-label="追番状态" onClick={event => event.stopPropagation()}>
      <span className="gz-sheet-handle" aria-hidden="true" />
      <h2 className="gz-sheet-title">追番状态</h2>
      <div className="gz-status-list">
        {FOLLOW_STATUS.map(row => <button type="button" key={row.id} className={`gz-status-row ${subjectStatusId === row.id ? "active" : ""}`} aria-pressed={subjectStatusId === row.id} disabled={saving} onClick={() => void saveStatus(row.id)}>
          <StatusIcon id={row.id} size={18} /><span>{row.label}</span>
        </button>)}
      </div>
    </section></div>}
    {playSource && <PlaySourceSheet key={subject.externalId} title={subject.title} episode={playSource.episode} resolveWork={resolvePlayWork} onClose={() => setPlaySource(null)} onToast={onToast} />}
  </div>;

  const comicDetailView = comicDetail && <div className="gz-subject">
    <div className="gz-subject-topbar">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => backHandler.current()}><ArrowLeft size={20} /></button>
      <BookDetailMenu workId={comicDetail.item.localWorkId} onRemoved={()=>{onLibraryChanged?.();onToast("已移出书架，原有数据已保留");}} onError={reason=>onToast(String(reason))}/>
    </div>
    <BookDetailHeader title={comicDetail.item.title} poster={<span className="gz-poster" data-explore-cover-id={comicDetail.item.pathWord}><ComicCover item={comicDetail.item} detail /></span>} kind={comicDetailKind} status={comicDetail.item.status} authors={comicDetail.item.authors} tags={comicDetail.item.tags} count={comicDetail.chapterCount ?? "—"} onTag={tag=>exploreTag(comicDetailKind,tag)} action={<button type="button" className={`gz-status-pill${comicDetail.item.localWorkId&&!shelfEntries[comicDetail.item.localWorkId]?.hidden ? " is-saved" : ""}`} disabled={saving || !!comicDetail.item.localWorkId&&!shelfEntries[comicDetail.item.localWorkId]?.hidden} onClick={() => void saveBook(comicDetail.item, comicDetailKind)}>{comicDetail.item.localWorkId&&!shelfEntries[comicDetail.item.localWorkId]?.hidden ? <Check size={16} /> : <BookOpen size={16} />}<span>{comicDetail.item.localWorkId&&!shelfEntries[comicDetail.item.localWorkId]?.hidden ? "已在书架" : "加入书架"}</span></button>}/>
    {bookDetailState === "loading" && <LoadingIndicator label="正在读取作品资料…" compact />}
    {bookDetailState === "error" && <div className="gz-error" role="alert"><span>作品资料读取失败，当前显示列表缓存。</span><button className="gz-iconbtn" aria-label="重试作品资料" onClick={() => void openBook(comicDetail.item, comicDetailKind)}><RefreshCw size={16} /></button></div>}
    <section className="gz-section">
      <div className="gz-section-head"><h2>简介</h2></div>
      <BookDescription text={comicDetail.item.summary} />
    </section>
    <div className="gz-book-actions"><button className="gz-book-action" onClick={() => setBookSelecting(value => !value)}>{bookSelecting ? <X size={18} /> : <Download size={18} />}{bookSelecting ? "取消" : "下载"}</button><button className="gz-book-action" onClick={() => setComicCommentsOpen(true)}><MessageCircle size={18} />评论</button><ImmediateBookFavorite key={`${comicDetailKind}:${comicDetail.item.pathWord}`} value={comicDetail.item.favorite} preview={next=>previewFavorite(comicDetail.item,comicDetailKind,next)} persist={next=>favoriteBook(comicDetail.item,comicDetailKind,next)} onError={reason=>onToast(String(reason))}/></div>
    <OnlineChapters key={`${comicDetailKind}:${comicDetail.item.pathWord}`} kind={comicDetailKind} pathWord={comicDetail.item.pathWord} selecting={bookSelecting} onSelecting={setBookSelecting} onRead={(entry, group) => { setReaderEntry(entry); setReaderGroup(group); }} onToast={onToast} />
  </div>;

  const comicSectionView = comicSection && <div className="gz-explore-section">
    <div className="gz-sched-head">
      <button className="gz-iconbtn" aria-label="返回发现" onClick={() => startPanelTransition("back", exploreBody.current, () => setView("feed"))}><ArrowLeft size={20} /></button>
      <h2>{COMIC_SECTION_LABELS[comicSection.section]}</h2>
      {comicSectionPage?.total != null && <span className="gz-meta">{comicSectionPage.total} 部</span>}
    </div>
    {comicSection.section === "ranking" && <div className="gz-seg gz-comic-period-seg" role="tablist" aria-label="榜单周期">
      {RANK_PERIODS.map(period => <button key={period} role="tab" aria-selected={comicSection.period === period} className={comicSection.period === period ? "active" : ""} onClick={() => openComicSection("ranking", period)}>{RANK_PERIOD_LABELS[period]}</button>)}
    </div>}
    {comicSectionState === "loading" && !comicSectionPage ? <LoadingIndicator label="正在读取作品…" compact />
      : comicSectionState === "error" ? <><div className="gz-error" role="alert"><span>{comicSectionError || "作品列表读取失败。"}</span></div><button className="gz-btn" onClick={() => openComicSection(comicSection.section, comicSection.period, true)}><RefreshCw size={16} />重试</button></>
        : comicSectionPage && comicSectionPage.items.length ? <>
          <div className="gz-comic-grid gz-comic-grid-lg">{comicSectionPage.items.map(entry => comicHomeCard(entry, comicSection.section === "ranking"))}</div>
          {comicSectionMoreError ? <div className="gz-error" role="alert"><span>更多作品读取失败，保留已有内容。</span><button className="gz-iconbtn" aria-label="重试更多漫画" onClick={() => void loadMoreComicSection()}><RefreshCw size={16} /></button></div> : comicSectionPage.hasMore && <div className="gz-sentinel" ref={comicSectionSentinelRef} aria-hidden="true" />}
          {comicSectionMore && <LoadingIndicator label="正在加载更多…" compact />}
        </> : <div className="gz-empty"><BookOpen size={26} /><h2>暂无作品</h2><p>该分组暂时没有内容。</p></div>}
  </div>;

  if (subject) return <div className="gz-explore">{subjectView}</div>;
  if (comicDetail) return <div className="gz-explore">{comicDetailView}{comicCommentsOpen && <ComicComments pathWord={comicDetail.item.pathWord} title={comicDetail.item.title} kind={comicDetailKind} onClose={() => setComicCommentsOpen(false)} />}{readerEntry && <BookReader kind={comicDetailKind} pathWord={comicDetail.item.pathWord} entryId={readerEntry.id} group={readerGroup} onClose={() => setReaderEntry(null)} />}</div>;
  if(tagTarget)return <TagDiscovery target={tagTarget} active={active} onBack={()=>setTagTarget(null)} renderAnime={animeCard} renderBook={(item,kind)=>comicCard(item,kind)}/>;

  return <div className="gz-explore" ref={explorePanel} onClickCapture={event => { clickedCoverRef.current = (event.target as HTMLElement).closest("button")?.querySelector<HTMLElement>("[data-explore-cover-id]") ?? null; }}>
    {view === "feed" && <>
      <div className="gz-explore-head">
        <div className="gz-seg gz-explore-tabs" role="tablist" aria-label="发现分类">
          {([["anime", "动漫"], ["comic", "漫画"], ["novel", "轻小说"]] as const).map(([id, label]) =>
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => switchTab(id)}>{label}</button>)}
        </div>
        <button className="gz-iconbtn" aria-label={searchOpen ? "关闭搜索" : "搜索"} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Search /></button>
      </div>
      {searchOpen && <form className="gz-search" role="search" onSubmit={submit}>
        <Search size={18} />
        <input type="search" aria-label={`搜索${tab === "anime" ? "动漫" : tab === "comic" ? "漫画" : "轻小说"}`} placeholder={tab === "anime" ? "搜索 Bangumi 条目" : tab === "comic" ? "搜索漫画" : "搜索轻小说"} value={query} onChange={event => setQuery(event.target.value)} />
        {searchTerm !== null && <button type="button" className="gz-iconbtn" aria-label="清除搜索" onClick={clearSearch}><X size={18} /></button>}
      </form>}
    </>}
    <div className="gz-explore-body" data-explore-body ref={exploreBody}>
    {view === "section" && comicSection ? comicSectionView : view === "schedule" ? scheduleView : <>

      {tab === "anime" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {animeResults.length} 条</p>
        {searching && !animeResults.length ? <LoadingIndicator label="正在搜索…" compact /> : animeResults.length
          ? <div className="gz-explore-grid">{animeResults.map(animeCard)}</div>
          : !searchError && <div className="gz-empty"><Search size={26} /><h2>没有匹配的条目</h2><p>换一个关键词再试。</p></div>}
      </> : animeState === "error" ? <>
        <div className="gz-error" role="alert"><span>{animeError || "Bangumi 数据读取失败。"}</span></div>
        <button className="gz-btn" onClick={() => void loadAnime(true)}><RefreshCw size={16} />重试</button>
      </> : animeState === "loading" ? <LoadingIndicator label="正在读取 Bangumi 数据…" compact /> : <>
        <section className="gz-section">
          <div className="gz-section-head"><h2>每日更新</h2>
            <button className="gz-link" onClick={() => startPanelTransition("forward", exploreBody.current, () => setView("schedule"))}><CalendarDays size={16} />时间表<ChevronRight size={16} /></button></div>
          {calendar ? (dailyItems.length
            ? <div className="gz-rail gz-cover-rail">{dailyItems.map(animeCard)}</div>
            : <p className="gz-panel gz-meta">今天没有更新的番组，去时间表看看本周放送。</p>)
            : <LoadingIndicator label="正在读取每日更新…" compact />}
        </section>
        <section className="gz-section"><div className="gz-section-head">
          <button className="gz-section-toggle" aria-expanded={tagsOpen} onClick={() => setTagsOpen(value => !value)}>
            <h2>热门番组</h2><ChevronDown size={16} className={tagsOpen ? "is-open" : ""} />
          </button>
          <span className="gz-meta">{hotItems.length} 部</span></div>
          {tagsOpen && <div className="gz-chips" role="group" aria-label="热门番组标签">
            {tagChips.map(tag => <button key={tag} className="gz-chip" onClick={() => exploreTag("anime",tag)}>{tag}</button>)}
          </div>}
          {popularLoading ? <LoadingIndicator label="正在读取热门番组…" compact /> : animeError ? <>
            <div className="gz-error" role="alert">{animeError}</div><button className="gz-btn" onClick={() => void loadAnime(true)}><RefreshCw size={16} />重试热门番组</button>
          </> : hotItems.length ? <><div className="gz-explore-grid">{hotItems.map(animeCard)}</div>{!rankingMoreError && rankingHasMore && <div className="gz-sentinel" ref={hotSentinelRef} aria-hidden="true" />}{rankingLoadingMore && <LoadingIndicator label="正在加载更多热门番组…" compact />}{rankingMoreError && <div className="gz-error" role="alert"><span>更多热门番组读取失败，保留已有内容。</span><button className="gz-iconbtn" aria-label="重试更多热门番组" onClick={() => void loadMoreRanking()}><RefreshCw size={16} /></button></div>}</> : <p className="gz-panel gz-meta">没有符合所选标签的热门番组。</p>}
        </section>
      </>)}
      {tab === "anime" && <p className="gz-explore-source gz-meta">每日更新来自 Bangumi 每日放送接口；热门番组按 Bangumi 动画目录热度排序。{trending.some(item => item.stale) ? "热门番组当前显示离线缓存。" : ""}</p>}

      {tab === "comic" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {searchTotal} 条 · 已显示 {comicResults.length} 条</p>
        {searching && !comicResults.length ? <LoadingIndicator label="正在搜索…" compact /> : comicResults.length
          ? <div className="gz-explore-grid">{comicResults.map(item => comicCard(item))}</div>
          : !searchError && <div className="gz-empty"><Search size={26} /><h2>没有匹配的漫画</h2><p>换一个关键词再试。</p></div>}
      </> : comicHomeState === "error" ? <>
        <div className="gz-error" role="alert"><span>{comicHomeError || "漫画首页读取失败。"}</span></div>
        <button className="gz-btn" onClick={() => void loadComicHome(true)}><RefreshCw size={16} />重试</button>
      </> : comicHomeState === "loading" && !comicHome ? <LoadingIndicator label="正在读取漫画首页…" compact /> : comicHome ? <>
        {comicSections.recommended && comicSections.recommended.items.length > 0 && <section className="gz-section">
          <div className="gz-section-head"><h2>推荐</h2><button className="gz-link" onClick={() => openComicSection("recommended")}>更多<ChevronRight size={16} /></button></div>
          <div className="gz-rail gz-cover-rail gz-comic-rail">{comicSections.recommended.items.map(entry => comicHomeCard(entry))}</div>
        </section>}
        {comicSections.ranking.length > 0 && <section className="gz-section">
          <div className="gz-section-head"><h2>排行榜</h2><button className="gz-link" onClick={() => openComicSection("ranking", "day")}>更多<ChevronRight size={16} /></button></div>
          {RANK_PERIODS.map(period => {
            const group = comicSections.ranking.find(section => section.period === period);
            if (!group || !group.items.length) return null;
            return <div className="gz-comic-period-block" key={period}>
              <p className="gz-comic-period">{RANK_PERIOD_LABELS[period]}</p>
              <div className="gz-comic-grid">{group.items.slice(0, 4).map(entry => comicHomeCard(entry, true))}</div>
            </div>;
          })}
        </section>}
        {comicSections.hotUpdates && comicSections.hotUpdates.items.length > 0 && <section className="gz-section">
          <div className="gz-section-head"><h2>热门更新</h2><span className="gz-meta">{comicSections.hotUpdates.items.length} 部</span></div>
          <div className="gz-rail gz-cover-rail gz-comic-rail">{comicSections.hotUpdates.items.map(entry => comicHomeCard(entry))}</div>
        </section>}
        {comicSections.newArrivals && comicSections.newArrivals.items.length > 0 && <section className="gz-section">
          <div className="gz-section-head"><h2>全新上架</h2><button className="gz-link" onClick={() => openComicSection("newArrivals")}>更多<ChevronRight size={16} /></button></div>
          <div className="gz-comic-grid">{comicSections.newArrivals.items.slice(0, 4).map(entry => comicHomeCard(entry))}</div>
        </section>}
        {comicSections.completed && comicSections.completed.items.length > 0 && <section className="gz-section">
          <div className="gz-section-head"><h2>已完结</h2><button className="gz-link" onClick={() => openComicSection("completed")}>更多<ChevronRight size={16} /></button></div>
          <div className="gz-comic-grid">{comicSections.completed.items.slice(0, 4).map(entry => comicHomeCard(entry))}</div>
        </section>}
        <p className="gz-explore-source gz-meta">漫画首页来自 COPY 目录的推荐、排行榜与新上架接口；数字为来源热度。{comicHome.stale ? "当前显示离线缓存。" : ""}{comicHome.warnings?.join(" ")}</p>
        {!!comicHome.warnings?.length && <button className="gz-btn" onClick={() => void loadComicHome(true)}>重试首页分组</button>}
      </> : null)}

      {tab === "novel" && (searchTerm !== null ? <>
        <p className="gz-meta">「{searchTerm}」共 {searchTotal} 条 · 已显示 {novelResults.length} 条</p>
        {searching && !novelResults.length ? <LoadingIndicator label="正在搜索…" compact /> : novelResults.length
          ? <div className="gz-explore-grid">{novelResults.map(item => comicCard(item, "novel"))}</div>
          : !searchError && <div className="gz-empty"><Search size={26} /><h2>没有匹配的轻小说</h2><p>换一个关键词再试。</p></div>}
      </> : <>
        <div className="gz-chips" role="radiogroup" aria-label="轻小说题材">
          <button className={`gz-chip ${novelTheme === "" ? "active" : ""}`} role="radio" aria-checked={novelTheme === ""} onClick={() => { setNovelTheme(""); void loadBooks(""); }}>全部</button>
          {novelThemes.map(item => <button key={item.pathWord} className={`gz-chip ${novelTheme === item.pathWord ? "active" : ""}`} role="radio" aria-checked={novelTheme === item.pathWord} onClick={() => { setNovelTheme(item.pathWord); void loadBooks(item.pathWord); }}>{item.name}</button>)}
        </div>
        {novelState === "error" ? <><div className="gz-error" role="alert"><span>{novelError || "轻小说来源读取失败。"}</span></div><button className="gz-btn" onClick={() => void loadBooks(novelTheme)}><RefreshCw size={16} />重试</button></>
          : novelState === "loading" ? <LoadingIndicator label="正在读取轻小说来源…" compact />
            : novels.length ? <><div className="gz-explore-grid">{novels.map(item => comicCard(item, "novel"))}</div>{!bookMoreError && bookPage * 24 < bookTotal && <div className="gz-sentinel" ref={bookSentinelRef} aria-hidden="true" />}{bookLoadingMore && <LoadingIndicator label="正在加载更多…" compact />}{bookMoreError && <div className="gz-error" role="alert"><span>更多轻小说读取失败，保留已有内容。</span><button className="gz-iconbtn" aria-label="重试更多轻小说" onClick={() => void loadBooks(novelTheme, bookPage + 1, true)}><RefreshCw size={16} /></button></div>}</>
              : <div className="gz-empty"><BookOpen size={26} /><h2>没有轻小说</h2><p>这个题材下暂无作品。</p></div>}
      </>)}
      {searchTerm !== null && <>
        {searchError ? <div className="gz-error" role="alert"><span>搜索读取失败，请重试。</span><button className="gz-iconbtn" aria-label="重试搜索" onClick={() => void loadSearch(searchTerm, searchPage ? searchPage + 1 : 1, searchPage > 0)}><RefreshCw size={16} /></button></div>
          : tab !== "anime" && searchPage * 24 < searchTotal && <div className="gz-sentinel" ref={searchSentinelRef} aria-hidden="true" />}
        {searching && searchPage > 0 && <LoadingIndicator label="正在加载更多搜索结果…" compact />}
      </>}
    </>}
    </div>

    {seasonOpen && <div className="gz-scrim" onClick={() => setSeasonOpen(false)}><section className="gz-sheet gz-season-sheet" role="dialog" aria-modal="true" aria-label="放送季度" onClick={event => event.stopPropagation()}>
      <span className="gz-sheet-handle" aria-hidden="true" />
      <button className="gz-iconbtn gz-sheet-close" aria-label="关闭" onClick={() => setSeasonOpen(false)}><X size={18} /></button>
      <h2 className="gz-season-title">放送季度</h2>
      <p className="gz-meta">正在查看 {scheduleYear} 年{SEASONS.find(season => season.month === scheduleMonth)?.label}</p>
      <div className="gz-season-groups">{seasonYears.map(year => <div className="gz-season-group" key={year}>
        <span className="gz-season-year">{year}</span>
        <div className="gz-seg gz-season-seg" role="radiogroup" aria-label={`${year} 年季度`}>
          {SEASONS.map(season => <button key={season.label} role="radio" aria-checked={scheduleYear === year && scheduleMonth === season.month} className={scheduleYear === year && scheduleMonth === season.month ? "active" : ""} onClick={() => { setScheduleYear(year); setScheduleMonth(season.month); setSeasonOpen(false); }}>{season.label}</button>)}
        </div>
      </div>)}</div>
    </section></div>}

  </div>;
}
