import { downloadBytes } from "./downloadCenterApi";

/** Short moving window; pauses, counter resets and background gaps start a fresh sample. */
export class DownloadRateMeter {
  private entries = new Map<string, { at: number; bytes: number }[]>();
  sample(id: string, bytes: number, active: boolean, now: number): number | null {
    if (!active) { this.entries.delete(id); return null; }
    const samples = this.entries.get(id), last = samples?.[samples.length - 1];
    if (!samples || !last || bytes < last.bytes || now - last.at > 10000 || now < last.at) {
      this.entries.set(id, [{ at: now, bytes }]); return null;
    }
    if (now > last.at) samples.push({ at: now, bytes });
    while (samples.length > 2 && samples[1]!.at <= now - 5000) samples.shift();
    const elapsed = now - samples[0]!.at;
    return elapsed >= 500 ? Math.max(0, (bytes - samples[0]!.bytes) * 1000 / elapsed) : null;
  }
  retain(ids: Set<string>) { for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id); }
}

export function downloadRateLabel(rate: number | null, remaining?: number): string {
  if (rate == null) return "正在计算速度…";
  let text = `${downloadBytes(rate)}/s`;
  if (rate > 0 && remaining != null && remaining > 0) {
    const seconds = Math.ceil(remaining / rate);
    const duration = seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.ceil(seconds / 60)} 分钟` : `${(seconds / 3600).toFixed(1)} 小时`;
    text += ` · 剩余约 ${duration}`;
  }
  return text;
}
