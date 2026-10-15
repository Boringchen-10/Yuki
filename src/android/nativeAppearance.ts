import type { ThemeMode } from "../types";

export interface NativeColors {
  background: string; raised: string; surface: string; menu: string;
  text: string; muted: string; accent: string; accentInk: string;
}
export interface NativeAppearance { mode: ThemeMode; light: NativeColors; dark: NativeColors }

export function opaqueHex(bytes: ArrayLike<number>): string {
  return `#${[0, 1, 2].map(index => Math.round(bytes[index]!).toString(16).padStart(2, "0")).join("")}`;
}

/** Resolve the real CSS tokens for both modes, including calc(), style tint and AMOLED. */
export function nativeAppearance(root: HTMLElement, mode: ThemeMode, lightAccent: number, darkAccent: number): NativeAppearance {
  const probe = root.cloneNode(false) as HTMLElement;
  probe.removeAttribute("id");
  Object.assign(probe.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", width: "1px", height: "1px", overflow: "hidden", contain: "strict" });
  const color = document.createElement("span"); probe.append(color); document.body.append(probe);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) { probe.remove(); throw new Error("无法读取主题颜色"); }
  const palette = (dark: boolean): NativeColors => {
    probe.dataset.theme = dark ? "dark" : "light";
    probe.style.setProperty("--accent-l", `${dark ? darkAccent : lightAccent}%`);
    const token = (name: string, background = "#000000") => {
      color.style.color = `var(--${name})`;
      context.fillStyle = background; context.fillRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(color).color; context.fillRect(0, 0, 1, 1);
      return opaqueHex(context.getImageData(0, 0, 1, 1).data);
    };
    const background = token("bg");
    return { background, raised: token("bg-raised", background), surface: token("surface", background), menu: token("surface-strong", background),
      text: token("text"), muted: token("muted"), accent: token("accent"), accentInk: token("accent-ink") };
  };
  try { return { mode, light: palette(false), dark: palette(true) }; }
  finally { probe.remove(); }
}
