import { api } from "../api";
import type { BangumiComment, BangumiCommentPage } from "../types";
import { androidSession } from "./sessionCache";

interface CommentPages {
  items: BangumiComment[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
}

export interface BangumiCommentsState extends CommentPages {
  subjectId: string | null;
  state: "idle" | "loading" | "ready" | "error";
  loadingMore: boolean;
  error: string | null;
  moreError: string | null;
}

export function emptyBangumiComments(subjectId: string | null = null): BangumiCommentsState {
  return { subjectId, items: [], total: 0, nextOffset: 0, hasMore: false, state: "idle", loadingMore: false, error: null, moreError: null };
}

// Keep the existing first-page cache key; the companion entry preserves appended pages.
export function createBangumiComments(
  read: (subjectId: string, offset: number) => Promise<BangumiCommentPage> = api.bangumiComments,
  cache = androidSession,
) {
  let snapshot = emptyBangumiComments();
  let generation = 0;
  let enabled = false;
  let pending: { promise?: Promise<void> } | null = null;
  const listeners = new Set<() => void>();
  const key = (id: string) => `bangumi:comments:${id}`;
  const update = (changes: Partial<BangumiCommentsState>) => {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach(listener => listener());
  };
  const pages = (page: BangumiCommentPage, previous: BangumiComment[] = []): CommentPages => ({
    items: [...new Map([...previous, ...page.items].map(item => [item.id, item])).values()],
    total: page.total,
    nextOffset: page.offset + page.limit,
    hasMore: page.items.length > 0 && page.offset + page.limit < page.total,
  });

  function load(first: boolean): Promise<void> {
    const id = snapshot.subjectId;
    if (pending) return pending.promise ?? Promise.resolve();
    if (!id || !enabled || (!first && (snapshot.state !== "ready" || !snapshot.hasMore || snapshot.moreError))) return Promise.resolve();
    const request = {} as { promise?: Promise<void> };
    pending = request;
    const current = generation;
    const offset = first ? 0 : snapshot.nextOffset;
    update(first ? { state: "loading", error: null, moreError: null } : { loadingMore: true, moreError: null });
    const isCurrent = () => generation === current && pending === request;
    request.promise = (async () => {
      try {
        const page = await cache.load(offset === 0 ? key(id) : `${key(id)}:page:${offset}`, () => read(id, offset));
        if (!isCurrent()) return;
        const value = pages(page, first ? [] : snapshot.items);
        cache.set(`${key(id)}:feed`, value);
        update({ ...value, state: "ready", error: null, moreError: null });
      } catch (reason) {
        if (!isCurrent()) return;
        const message = String(reason);
        update(first ? { state: "error", error: message } : { moreError: message });
      } finally {
        if (isCurrent()) { pending = null; update({ loadingMore: false }); }
      }
    })();
    return request.promise;
  }

  function open(subjectId: string | null, active = true): Promise<void> {
    enabled = active;
    if (snapshot.subjectId !== subjectId) {
      generation++;
      pending = null;
      const cached = subjectId ? cache.peek<CommentPages>(`${key(subjectId)}:feed`) : undefined;
      const first = subjectId ? cache.peek<BangumiCommentPage>(key(subjectId)) : undefined;
      const value = cached ?? (first ? pages(first) : null);
      snapshot = emptyBangumiComments(subjectId);
      update(value ? { ...value, state: "ready" } : {});
    }
    return enabled && snapshot.state === "idle" ? load(true) : pending?.promise ?? Promise.resolve();
  }

  function refresh(): Promise<void> {
    if (!snapshot.subjectId) return Promise.resolve();
    generation++;
    pending = null;
    cache.invalidate(key(snapshot.subjectId));
    update({ state: "idle", loadingMore: false, error: null, moreError: null });
    return enabled ? load(true) : Promise.resolve();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open,
    loadMore: () => load(false),
    retry: () => pending?.promise ?? refresh(),
    retryMore: () => { if (pending) return pending.promise ?? Promise.resolve(); update({ moreError: null }); return load(false); },
    refresh,
    close: () => { generation++; pending = null; enabled = false; snapshot = emptyBangumiComments(); listeners.forEach(listener => listener()); },
  };
}
