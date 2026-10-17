import type { ThemeStyle } from "../store";

export const themeStyles: { id: ThemeStyle; label: string; sat: number; light: number; neutral: number; lift?: number; rainbow?: boolean }[] = [
  { id: "soft", label: "柔和", sat: 0.95, light: 1, neutral: 28, lift: 0 },
  { id: "vivid", label: "鲜明", sat: 1.4, light: 1.06, neutral: 48, lift: 1.2 },
  { id: "expressive", label: "表现", sat: 1.6, light: 1.12, neutral: 62, lift: 2.4 },
  { id: "accurate", label: "准确", sat: 0.85, light: 0.94, neutral: 14, lift: 0 },
  { id: "content", label: "内容", sat: 1.15, light: 1, neutral: 34, lift: 0.6 },
  { id: "neutral", label: "中性", sat: 0.4, light: 0.98, neutral: 8, lift: 1 },
  { id: "mono", label: "黑白", sat: 0, light: 1, neutral: 0, lift: 1.5 },
  { id: "rainbow", label: "彩虹", sat: 1.45, light: 1.06, neutral: 58, lift: 1.5, rainbow: true },
];

export function resolveThemeAccent(themeStyle: ThemeStyle, accentSat: number, accentLight: number) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const accentStyle = themeStyles.find(item => item.id === themeStyle) ?? themeStyles[0]!;
  return { accentStyle, accentSatValue: clamp(accentSat * accentStyle.sat, 0, 100),
    darkAccentLight: clamp(accentLight * accentStyle.light, 10, 92), lightAccentLight: clamp(accentLight * accentStyle.light * 0.5, 12, 46),
    neutralSatValue: clamp(accentStyle.neutral, 0, 100), neutralLiftValue: accentStyle.lift ?? 0 };
}
