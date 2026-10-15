import { describe, expect, it } from "vitest";
import { readingHistoryKey, readingLocationLabel } from "./readingHistory";

describe("reading history identity and saved locations", () => {
  it("keeps source books, groups, chapters and kinds separate", () => {
    const item = { kind: "comic" as const, pathWord: "book", group: "default", entryId: "one" };
    expect(new Set([
      readingHistoryKey(item),
      readingHistoryKey({ ...item, kind: "novel" }),
      readingHistoryKey({ ...item, pathWord: "other" }),
      readingHistoryKey({ ...item, group: "volume" }),
      readingHistoryKey({ ...item, entryId: "two" }),
    ]).size).toBe(5);
  });
  it("presents zero-based comic locations as actual pages", () => {
    expect(readingLocationLabel({ kind: "comic", location: { pageIndex: 0 }, pageCount: 24 })).toBe("第 1 页 / 共 24 页");
    expect(readingLocationLabel({ kind: "comic", location: { pageIndex: 23 }, pageCount: 24 })).toBe("第 24 页 / 共 24 页");
    expect(readingLocationLabel({ kind: "comic", location: { pageIndex: 3 }, pageCount: null })).toBe("第 4 页");
    expect(readingLocationLabel({ kind: "comic", location: { pageIndex: -1 }, pageCount: 24 })).toBe("已保存阅读位置");
  });
  it("distinguishes novel volume progress from the current section", () => {
    expect(readingLocationLabel({ kind: "novel", location: { locations: { totalProgression: 0.42, progression: 0.9 } }, pageCount: null })).toBe("本卷已读 42%");
    expect(readingLocationLabel({ kind: "novel", location: { locations: { progression: 0.4 } }, pageCount: null })).toBe("本节已读 40%");
    expect(readingLocationLabel({ kind: "novel", location: { href: "OEBPS/chapter-0.xhtml" }, pageCount: null })).toBe("已保存阅读位置");
    expect(readingLocationLabel({ kind: "novel", location: { locations: { totalProgression: 2 } }, pageCount: null })).toBe("已保存阅读位置");
  });
});
