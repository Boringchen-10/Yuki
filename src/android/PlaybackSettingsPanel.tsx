import { useEffect, useState } from "react";
import { ChevronRight, Cpu, Monitor, Sparkles } from "lucide-react";
import { androidApi, type PlaybackPreferences } from "./api";
import LoadingIndicator from "./LoadingIndicator";
import "./playbackSettings.css";

const decoders: { value: PlaybackPreferences["hardwareDecoder"]; title: string; hint: string }[] = [
  { value: "auto", title: "auto", hint: "自动选择可用的安卓硬件解码器" },
  { value: "auto-safe", title: "auto-safe", hint: "优先选择兼容的硬件解码器" },
  { value: "auto-copy", title: "auto-copy", hint: "自动选择带拷贝的硬件解码器" },
  { value: "mediacodec", title: "mediacodec", hint: "Android MediaCodec" },
  { value: "mediacodec-copy", title: "mediacodec-copy", hint: "Android MediaCodec 拷贝模式" },
];
const renderers: { value: PlaybackPreferences["videoRenderer"]; title: string; hint: string }[] = [
  { value: "auto", title: "自动", hint: "按安卓版本与设备能力选择 Vulkan 或 OpenGL" },
  { value: "gpu", title: "OpenGL · gpu", hint: "通用 GPU 渲染，支持超分和字幕" },
  { value: "gpu-next", title: "Vulkan · gpu-next", hint: "支持超分和字幕，不可用时尝试 OpenGL" },
  { value: "mediacodec_embed", title: "低功耗直通", hint: "使用 MediaCodec 硬解，不支持超分和字幕" },
];
const modes = [
  { value: 0, title: "关闭", hint: "默认关闭超分辨率" },
  { value: 1, title: "流畅档", hint: "基于 Anime4K，优先兼顾画面与播放流畅度" },
  { value: 2, title: "画质档", hint: "基于 Anime4K，画面处理负载更高" },
] as const;
export type PlaybackSettingsPage = "main" | "decoder" | "renderer" | "super";

export default function PlaybackSettingsPanel({ page = "main", onNavigate }: { page?: PlaybackSettingsPage; onNavigate: (page: PlaybackSettingsPage) => void }) {
  const [settings, setSettings] = useState<PlaybackPreferences | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState<PlaybackPreferences | null>(null);
  useEffect(() => {
    let active = true;
    void androidApi.playbackPreferences().then(value => { if (active) setSettings(value); }).catch(() => { if (active) setError("播放设置暂时无法读取，请返回后重试。"); });
    return () => { active = false; };
  }, []);
  async function save(next: PlaybackPreferences) {
    if (saving) return;
    setSaving(true); setError(""); setRetry(next);
    try { setSettings(await androidApi.savePlaybackPreferences(next)); setRetry(null); }
    catch { setError("暂未确认保存成功，请重试。"); }
    finally { setSaving(false); }
  }
  if (!settings) return error ? <p className="gz-error" role="alert">{error}</p> : <LoadingIndicator label="正在读取播放设置…" compact />;
  const choice = <T extends string | number,>(title: string, selected: T, items: { value: T; title: string; hint: string }[], change: (value: T) => void) => <section className="gz-block">
    <h2 className="gz-block-title">{title}</h2><div className="gz-block-body" role="radiogroup" aria-label={title}>{items.map(item => <button key={item.value} type="button" role="radio" aria-checked={selected === item.value} disabled={saving} className="gz-player-choice" onClick={() => change(item.value)}><span className="gz-row-main"><strong>{item.title}</strong><span className="gz-meta">{item.hint}</span></span><span className={`gz-player-radio${selected === item.value ? " active" : ""}`} aria-hidden="true" /></button>)}</div>
  </section>;
  return <div className="gz-player-settings" aria-busy={saving}>
    {error && <div className="gz-error" role="alert"><span>{error}</span>{retry && <button type="button" className="gz-link" disabled={saving} onClick={() => void save(retry)}>重试保存</button>}</div>}
    {page === "main" && <section className="gz-block"><h2 className="gz-block-title">解码与渲染</h2><div className="gz-block-body">
      <button type="button" className="gz-toggle-row" role="switch" aria-checked={settings.hardwareDecoding} disabled={saving} onClick={() => void save({ ...settings, hardwareDecoding: !settings.hardwareDecoding, videoRenderer: settings.hardwareDecoding && settings.videoRenderer === "mediacodec_embed" ? "gpu" : settings.videoRenderer })}><Cpu size={21} /><span className="gz-row-main"><strong>硬件解码</strong><span className="gz-meta">使用设备解码能力处理视频</span></span><span className={`gz-switch${settings.hardwareDecoding ? " active" : ""}`} aria-hidden="true"><span /></span></button>
      <button type="button" className="gz-player-row" disabled={saving || !settings.hardwareDecoding} onClick={() => onNavigate("decoder")}><Cpu size={21} /><span className="gz-row-main"><strong>硬件解码器</strong><span className="gz-meta">仅在硬件解码开启时生效 · {settings.hardwareDecoder}</span></span><ChevronRight size={18} /></button>
      <button type="button" className="gz-player-row" disabled={saving} onClick={() => onNavigate("renderer")}><Monitor size={21} /><span className="gz-row-main"><strong>视频渲染器</strong><span className="gz-meta">{renderers.find(item => item.value === settings.videoRenderer)?.title}</span></span><ChevronRight size={18} /></button>
      <button type="button" className="gz-player-row" disabled={saving} onClick={() => onNavigate("super")}><Sparkles size={21} /><span className="gz-row-main"><strong>超分辨率</strong><span className="gz-meta">{modes.find(item => item.value === settings.superResolution)?.title}</span></span><ChevronRight size={18} /></button>
    </div></section>}
    {page === "decoder" && <><p className="gz-meta">当前列出安卓适用解码器，硬解不可用时会尝试软件解码。</p>{choice("硬件解码器", settings.hardwareDecoder, decoders, hardwareDecoder => void save({ ...settings, hardwareDecoder, videoRenderer: ["compat", "mediacodec_embed"].includes(settings.videoRenderer) ? "auto" : settings.videoRenderer }))}</>}
    {page === "renderer" && choice("视频渲染器", settings.videoRenderer, renderers, videoRenderer => void save(videoRenderer === "mediacodec_embed" ? { ...settings, videoRenderer, hardwareDecoding: true, hardwareDecoder: "mediacodec", superResolution: 0 } : { ...settings, videoRenderer }))}
    {page === "super" && <><p className="gz-meta">超分需要 GPU 渲染。使用直通模式时，开启超分会切换为 OpenGL；硬件解码可减轻处理负担。</p>{choice("超分辨率", settings.superResolution, [...modes], superResolution => void save({ ...settings, superResolution, videoRenderer: superResolution > 0 && settings.videoRenderer === "mediacodec_embed" ? "gpu" : settings.videoRenderer }))}</>}
    <p className="gz-meta gz-player-save" role="status">{saving ? "正在保存…" : "设置自动保存，下次打开视频时生效。"}</p>
  </div>;
}
