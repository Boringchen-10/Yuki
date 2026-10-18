import { describe, expect, it } from "vitest";
import { DownloadRateMeter, downloadRateLabel } from "./downloadRate";

describe("download transfer rates", () => {
  it("measures bytes over time and drops pause, reset and background history", () => {
    const meter = new DownloadRateMeter();
    expect(meter.sample("one", 100, true, 0)).toBeNull();
    expect(meter.sample("one", 1100, true, 1000)).toBe(1000);
    expect(meter.sample("one", 1100, false, 2000)).toBeNull();
    expect(meter.sample("one", 1100, true, 3000)).toBeNull();
    expect(meter.sample("one", 50, true, 4000)).toBeNull();
    expect(meter.sample("one", 2000, true, 20000)).toBeNull();
  });
  it("keeps independent windows and reaches zero when a transfer stalls", () => {
    const meter = new DownloadRateMeter();
    meter.sample("one", 0, true, 0); meter.sample("two", 0, true, 0);
    expect(meter.sample("one", 10000, true, 1000)).toBe(10000);
    expect(meter.sample("two", 2000, true, 1000)).toBe(2000);
    meter.sample("one", 10000, true, 5000);
    expect(meter.sample("one", 10000, true, 6000)).toBe(0);
    meter.retain(new Set()); expect(meter.sample("one", 10000, true, 7000)).toBeNull();
  });
  it("shows remaining time only when both size and rate are known", () => {
    expect(downloadRateLabel(null)).toBe("正在计算速度…");
    expect(downloadRateLabel(0, 1000)).toBe("0 B/s");
    expect(downloadRateLabel(1024)).toBe("1.0 KB/s");
    expect(downloadRateLabel(1024, 10240)).toContain("10 秒");
    expect(downloadRateLabel(1024, 1024 * 90)).toContain("2 分钟");
  });
});
