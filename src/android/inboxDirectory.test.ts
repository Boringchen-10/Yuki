import { describe, expect, it } from "vitest";
import type { UnassignedMediaGroup } from "../types";
import { inboxDirectory, inInboxDirectory } from "./inboxDirectory";

const group = (source: string, folderPath: string) => ({ folderPath, representative: { libraryRootId: source } }) as UnassignedMediaGroup;
describe("indexed source directory navigation", () => {
  it("keeps decoded names, literal percent signs and case", () => {
    expect(inboxDirectory(group("dav", "webdav://dav/动画/2024/作品%20甲"))).toEqual(["动画", "2024", "作品%20甲"]);
    expect(inboxDirectory(group("saf", "saf://saf/Anime/Work A"))).toEqual(["Anime", "Work A"]);
  });
  it("does not mix connections, path prefixes or differently cased folders", () => {
    const item = group("dav", "webdav://dav/动画/作品甲");
    expect(inInboxDirectory(item, "dav", ["动画"])).toBe(true);
    expect(inInboxDirectory(item, "other", ["动画"])).toBe(false);
    expect(inInboxDirectory(item, "dav", ["动画", "作品"])).toBe(false);
    expect(inInboxDirectory(group("dav", "webdav://dav/Anime/Work"), "dav", ["anime"])).toBe(false);
  });
});
