import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import FirstRunGate from "../../src/android/FirstRunGate";
import { androidApi } from "../../src/android/api";
import { api } from "../../src/api";
import { rulesApi, type RulePlugin } from "../../src/android/rulesApi";
import { rulesNetworkApi, type RulesNetworkMode } from "../../src/android/rulesNetwork";
import { ONBOARDING_KEY } from "../../src/android/onboarding";
import { usePreferences } from "../../src/store";
import { nativeAppearance } from "../../src/android/nativeAppearance";
import { resolveThemeAccent } from "../../src/android/themeStyles";
import "../../src/styles.css";

let plugins: RulePlugin[] = [];
let catalogCalls = 0, backgroundCalls = 0, installFail = false, readFail = false, writeFail = false;
let networkMode: RulesNetworkMode = "auto", networkCalls = 0, networkSaveFail = false, catalogFail = false;
const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
Storage.prototype.getItem = function(key) { if (readFail && key === ONBOARDING_KEY) throw new Error("read denied"); return getItem.call(this, key); };
Storage.prototype.setItem = function(key, value) { if (writeFail && key === ONBOARDING_KEY) throw new Error("storage full"); setItem.call(this, key, value); };
androidApi.safeArea = async () => ({ top: 38, bottom: 24, left: 0, right: 0 });
androidApi.appearance = async () => {};
api.getSetting = async () => null;
androidApi.startBackgroundServices = async () => { backgroundCalls++; };
rulesApi.plugins = async () => structuredClone(plugins);
rulesApi.catalog = async () => { catalogCalls++; if (catalogFail) throw new Error("规则仓库连接失败，稍后重试"); return { items: Array.from({ length: 12 }, (_, i) => ({ name: `示例规则 ${i + 1}`, version: "1.0" })), stale: false, source: networkMode === "auto" ? "mirror" : "official" }; };
rulesNetworkApi.get = async () => { networkCalls++; return { mode: networkMode }; };
rulesNetworkApi.save = async config => { await new Promise(resolve => setTimeout(resolve, 150)); if (networkSaveFail) throw new Error("连接方式保存失败"); networkMode = config.mode; return config; };
rulesNetworkApi.probe = async () => { await new Promise(resolve => setTimeout(resolve, 150)); return networkMode === "direct" ? [{ source: "official", milliseconds: 100, error: null }] : [{ source: "mirror", milliseconds: 40, error: null }, { source: "official", milliseconds: 0, error: "连接超时" }]; };
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
    stats: () => ({ catalogCalls, backgroundCalls, plugins, networkMode, networkCalls }),
    networkFail: (save: boolean, catalog: boolean) => { networkSaveFail = save; catalogFail = catalog; },
    installFail: (value: boolean) => { installFail = value; },
    storageFail: (read: boolean, write: boolean) => { readFail = read; writeFail = write; },
    appearance: (theme: "light" | "dark", fontScale: number) => { usePreferences.getState().setTheme(theme); usePreferences.getState().setFontScale(fontScale); },
    accent: (hue: number) => usePreferences.getState().setAccentHue(hue),
    resetAppearance: () => usePreferences.getState().resetAppearance(),
    palette: () => { const prefs = usePreferences.getState(); const { lightAccentLight, darkAccentLight } = resolveThemeAccent(prefs.themeStyle, prefs.accentSat, prefs.accentLight); return nativeAppearance(document.querySelector(".android-app")!, prefs.theme, lightAccentLight, darkAccentLight); },
    reset: () => { readFail = false; writeFail = false; networkSaveFail = false; catalogFail = false; plugins = []; catalogCalls = 0; backgroundCalls = 0; networkCalls = 0; localStorage.removeItem(ONBOARDING_KEY); setKey(value => value + 1); },
  } });
  return <FirstRunGate key={key}><App /></FirstRunGate>;
}
document.documentElement.dataset.platform = "android";
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
