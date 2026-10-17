import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import FirstRunGate from "../../src/android/FirstRunGate";
import { androidApi } from "../../src/android/api";
import { api } from "../../src/api";
import { rulesApi, type RulePlugin } from "../../src/android/rulesApi";
import { ONBOARDING_KEY } from "../../src/android/onboarding";
import { usePreferences } from "../../src/store";
import { nativeAppearance } from "../../src/android/nativeAppearance";
import { resolveThemeAccent } from "../../src/android/themeStyles";
import "../../src/styles.css";

let plugins: RulePlugin[] = [];
let catalogCalls = 0, backgroundCalls = 0, installFail = false, readFail = false, writeFail = false;
const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
Storage.prototype.getItem = function(key) { if (readFail && key === ONBOARDING_KEY) throw new Error("read denied"); return getItem.call(this, key); };
Storage.prototype.setItem = function(key, value) { if (writeFail && key === ONBOARDING_KEY) throw new Error("storage full"); setItem.call(this, key, value); };
androidApi.safeArea = async () => ({ top: 38, bottom: 24, left: 0, right: 0 });
androidApi.appearance = async () => {};
api.getSetting = async () => null;
androidApi.startBackgroundServices = async () => { backgroundCalls++; };
rulesApi.plugins = async () => structuredClone(plugins);
rulesApi.catalog = async () => { catalogCalls++; return { items: Array.from({ length: 12 }, (_, i) => ({ name: `示例规则 ${i + 1}`, version: "1.0" })), stale: false }; };
async function install(name: string) {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (installFail) throw new Error("受控安装失败，请重试");
  plugins.push({ id: name, name, version: "1.0", enabled: true, origin: null, updatedAt: "2026-10-17" });
  return name;
}
rulesApi.install = install;
rulesApi.importUrl = async () => install("自定义链接规则");
rulesApi.import = async () => install("自定义 JSON 规则");
function App() {
  useEffect(() => { void androidApi.startBackgroundServices(); }, []);
  return <h1>已进入主应用</h1>;
}
function Fixture() {
  const [key, setKey] = useState(0);
  Object.assign(window, { __onboarding: {
    remount: () => setKey(value => value + 1),
    stats: () => ({ catalogCalls, backgroundCalls, plugins }),
    installFail: (value: boolean) => { installFail = value; },
    storageFail: (read: boolean, write: boolean) => { readFail = read; writeFail = write; },
    appearance: (theme: "light" | "dark", fontScale: number) => { usePreferences.getState().setTheme(theme); usePreferences.getState().setFontScale(fontScale); },
    accent: (hue: number) => usePreferences.getState().setAccentHue(hue),
    resetAppearance: () => usePreferences.getState().resetAppearance(),
    palette: () => { const prefs = usePreferences.getState(); const { lightAccentLight, darkAccentLight } = resolveThemeAccent(prefs.themeStyle, prefs.accentSat, prefs.accentLight); return nativeAppearance(document.querySelector(".android-app")!, prefs.theme, lightAccentLight, darkAccentLight); },
    reset: () => { readFail = false; writeFail = false; plugins = []; catalogCalls = 0; backgroundCalls = 0; localStorage.removeItem(ONBOARDING_KEY); setKey(value => value + 1); },
  } });
  return <FirstRunGate key={key}><App /></FirstRunGate>;
}
document.documentElement.dataset.platform = "android";
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
