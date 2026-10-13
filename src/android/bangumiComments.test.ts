import { describe, expect, it, vi } from "vitest";
import type { BangumiComment, BangumiCommentPage } from "../types";
import { createBangumiComments } from "./bangumiComments";
import { createSessionCache } from "./sessionCache";

const item = (id: string): BangumiComment => ({ id, userName: id, userAvatar: null, comment: id, createdAt: "", rate: null });
const page = (ids: string[], offset = 0, total = 60): BangumiCommentPage => ({ items: ids.map(item), offset, total, limit: 20 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Bangumi comment pages", () => {
  it("shares an in-flight first page and synchronously blocks repeated append calls", async () => {
    const first = deferred<BangumiCommentPage>();
    const more = deferred<BangumiCommentPage>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(more.promise);
    const feed = createBangumiComments(read, createSessionCache());
    const initial = feed.open("a");
    void feed.open("a"); void feed.loadMore();
    await Promise.resolve(); expect(read).toHaveBeenCalledTimes(1);
    first.resolve(page(["a1"])); await initial;
    const append = feed.loadMore();
    void feed.loadMore(); void feed.loadMore();
    await Promise.resolve(); expect(read).toHaveBeenCalledTimes(2);
    more.resolve(page(["a2"], 20)); await append;
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["a1", "a2"]);
  });

  it("ignores a late first page after switching subjects", async () => {
    const old = deferred<BangumiCommentPage>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(["b1"]));
    const feed = createBangumiComments(read, createSessionCache());
    const initial = feed.open("a"); await Promise.resolve();
    await feed.open("b"); old.resolve(page(["a1"])); await initial;
    expect(feed.getSnapshot().subjectId).toBe("b");
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["b1"]);
  });

  it("ignores an old append and its finally while the next subject is appending", async () => {
    const old = deferred<BangumiCommentPage>();
    const current = deferred<BangumiCommentPage>();
    const read = vi.fn().mockResolvedValueOnce(page(["a1"])).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(["b1"])).mockReturnValueOnce(current.promise);
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a"); const append = feed.loadMore(); await Promise.resolve();
    await feed.open("b"); const next = feed.loadMore(); await Promise.resolve();
    old.resolve(page(["a2"], 20)); await append;
    expect(feed.getSnapshot()).toMatchObject({ subjectId: "b", state: "ready", loadingMore: true });
    void feed.loadMore(); expect(read).toHaveBeenCalledTimes(4);
    current.resolve(page(["b2"], 20)); await next;
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["b1", "b2"]);
  });

  it("does not surface an old subject's late network error", async () => {
    const old = deferred<BangumiCommentPage>();
    const read = vi.fn().mockResolvedValueOnce(page(["a1"])).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(["b1"]));
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a"); const append = feed.loadMore(); await Promise.resolve();
    await feed.open("b"); old.reject(new Error("old offline")); await append;
    expect(feed.getSnapshot()).toMatchObject({ subjectId: "b", state: "ready", error: null, moreError: null });
  });

  it("advances by consumed server rows even when comments are filtered or duplicated", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["1", "2"])).mockResolvedValueOnce(page(["2", "3"], 20)).mockResolvedValueOnce(page(["3", "4"], 40));
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a"); await feed.loadMore(); await feed.loadMore();
    expect(read.mock.calls).toEqual([["a", 0], ["a", 20], ["a", 40]]);
    expect(feed.getSnapshot()).toMatchObject({ nextOffset: 60, hasMore: false });
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("stops on an empty response even if the upstream total is larger", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["1"])).mockResolvedValueOnce(page([], 20, 100));
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a"); await feed.loadMore(); await feed.loadMore();
    expect(read).toHaveBeenCalledTimes(2);
    expect(feed.getSnapshot()).toMatchObject({ hasMore: false, nextOffset: 40 });
  });

  it("keeps loaded comments after an append failure and waits for explicit retry", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["1"])).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page(["2"], 20));
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a"); await feed.loadMore();
    expect(feed.getSnapshot()).toMatchObject({ state: "ready", moreError: "Error: offline", nextOffset: 20, loadingMore: false });
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["1"]);
    await feed.loadMore(); await feed.loadMore();
    expect(read).toHaveBeenCalledTimes(2);
    await feed.retryMore(); expect(read.mock.calls[2]).toEqual(["a", 20]);
    expect(feed.getSnapshot().moreError).toBeNull();
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["1", "2"]);
  });

  it("retries a failed first page once and ignores that retry after switching subjects", async () => {
    const retry = deferred<BangumiCommentPage>();
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(retry.promise).mockResolvedValueOnce(page(["b1"]));
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a"); await feed.open("a"); expect(read).toHaveBeenCalledTimes(1);
    const pending = feed.retry(); void feed.retry(); await Promise.resolve(); expect(read).toHaveBeenCalledTimes(2);
    await feed.open("b"); retry.resolve(page(["a1"])); await pending;
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["b1"]);
  });

  it("restores all session pages and the independent cursor on revisit", async () => {
    const cache = createSessionCache();
    cache.set("bangumi:comments:a", page(["1"]));
    const read = vi.fn().mockResolvedValueOnce(page(["2"], 20)).mockResolvedValueOnce(page(["3"], 40));
    const first = createBangumiComments(read, cache);
    await first.open("a"); expect(read).not.toHaveBeenCalled();
    await first.loadMore(); first.close();
    const second = createBangumiComments(read, cache); await second.open("a");
    expect(second.getSnapshot().items.map(value => value.id)).toEqual(["1", "2"]);
    await second.loadMore(); expect(read.mock.calls).toEqual([["a", 20], ["a", 40]]);
  });

  it("invalidates old requests on network refresh, including the shared cache", async () => {
    const old = deferred<BangumiCommentPage>();
    const cache = createSessionCache();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(["new"]));
    const feed = createBangumiComments(read, cache);
    const first = feed.open("a"); await Promise.resolve();
    await feed.refresh(); old.resolve(page(["old"])); await first;
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["new"]);
    expect(cache.peek<BangumiCommentPage>("bangumi:comments:a")?.items.map(value => value.id)).toEqual(["new"]);
  });

  it("defers a disabled subject's refresh until comments become active", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["1"])).mockResolvedValueOnce(page(["new"]));
    const feed = createBangumiComments(read, createSessionCache());
    await feed.open("a", false); expect(read).not.toHaveBeenCalled();
    await feed.open("a"); await feed.open("a", false); await feed.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["1"]);
    await feed.open("a"); expect(read).toHaveBeenCalledTimes(2);
    expect(feed.getSnapshot().items.map(value => value.id)).toEqual(["new"]);
  });
});
