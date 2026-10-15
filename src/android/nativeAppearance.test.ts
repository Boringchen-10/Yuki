import { describe, expect, it } from "vitest";
import { opaqueHex } from "./nativeAppearance";

describe("native palette encoding", () => {
  it("encodes browser-composited RGB bytes without swapping Android alpha order", () => {
    expect(opaqueHex(new Uint8ClampedArray([255, 4, 0, 255]))).toBe("#ff0400");
    expect(opaqueHex(new Uint8ClampedArray([0, 0, 0, 255]))).toBe("#000000");
    expect(opaqueHex(new Uint8ClampedArray([244, 247, 246, 255]))).toBe("#f4f7f6");
  });
});
