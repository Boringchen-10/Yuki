import { describe, expect, it } from "vitest";
import { commentTime } from "./CommentIdentity";

describe("source comment time", () => {
  const now = Date.parse("2026-10-13T08:00:00Z");
  it("shows source-relative minutes, hours and days without negative future ages", () => {
    expect(commentTime("2026-10-13T07:55:00Z", now)).toBe("5分钟前");
    expect(commentTime("2026-10-13T06:00:00Z", now)).toBe("2小时前");
    expect(commentTime("2026-10-10T08:00:00Z", now)).toBe("3天前");
    expect(commentTime("2026-10-13T09:00:00Z", now)).toBe("刚刚");
    expect(commentTime("invalid", now)).toBe("invalid");
  });
});
