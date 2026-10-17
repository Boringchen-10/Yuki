import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, BookOpen, Check, FileCheck2, HardDrive, ShieldCheck, Snowflake } from "lucide-react";
import { androidApi } from "./api";
import { api } from "../api";
import { usePreferences } from "../store";
import { nativeAppearance } from "./nativeAppearance";
import { resolveThemeAccent } from "./themeStyles";
import RuleSourceManager from "./RuleSourceManager";
import LegalNotice from "./LegalNotice";
import { AGREEMENT_VERSION, readOnboarding, saveOnboarding, type OnboardingRecord } from "./onboarding";
import "./mobile.css";
import "./onboarding.css";

export default function FirstRunGate({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try { return { record: readOnboarding(localStorage), error: "" }; }
    catch { return { record: null, error: "无法读取本机确认状态，请重试。" }; }
  });
  const [record, setRecord] = useState<OnboardingRecord | null>(initial.record);
  const [error, setError] = useState(initial.error), [readFailed, setReadFailed] = useState(!!initial.error);
  const [checked, setChecked] = useState(false), [declined, setDeclined] = useState(false), [busy, setBusy] = useState(false);
  const [sourceCount, setSourceCount] = useState(0);
  const root = useRef<HTMLDivElement>(null), scroll = useRef<HTMLElement>(null);
  const subviewBack = useRef<(() => boolean) | null>(null);
  const registerBack = useRef((handler: (() => boolean) | null) => { subviewBack.current = handler; }).current;
  const theme = usePreferences(state => state.theme), setTheme = usePreferences(state => state.setTheme), fontScale = usePreferences(state => state.fontScale);
  const accentHue = usePreferences(state => state.accentHue), accentSat = usePreferences(state => state.accentSat), accentLight = usePreferences(state => state.accentLight);
  const themeStyle = usePreferences(state => state.themeStyle), amoled = usePreferences(state => state.amoled);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const ready = !!record?.completedAt;
  const { accentSatValue, darkAccentLight, lightAccentLight, neutralSatValue, neutralLiftValue } = resolveThemeAccent(themeStyle, accentSat, accentLight);
  useEffect(() => {
    if (ready) return;
    let active = true;
    void api.getSetting("theme").then(value => { if (active && (value === "light" || value === "dark" || value === "system")) setTheme(value); }).catch(() => {});
    return () => { active = false; };
  }, [ready, setTheme]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (ready) return;
    const apply = () => void androidApi.safeArea().then(area => {
      document.documentElement.style.setProperty("--safe-top", `${area.top}px`);
      document.documentElement.style.setProperty("--safe-bottom", `${area.bottom}px`);
    }).catch(() => {});
    apply(); window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [ready]);
  useEffect(() => {
    if (ready || !root.current) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    void androidApi.appearance(dark, nativeAppearance(root.current, theme, lightAccentLight, darkAccentLight)).catch(() => {});
  }, [ready, dark, theme, accentHue, accentSatValue, lightAccentLight, darkAccentLight, neutralSatValue, neutralLiftValue, amoled]);
  useEffect(() => {
    if (ready) return;
    const target = window as Window & { __genzoBack?: () => boolean };
    const back = () => {
      if (busy) return true;
      const dialog = document.querySelector<HTMLDialogElement>("dialog[data-rule-dialog][open]");
      if (dialog) { if (!subviewBack.current?.()) dialog.close(); return true; }
      if (subviewBack.current?.()) return true;
      if (declined) { setDeclined(false); return true; }
      return false;
    };
    target.__genzoBack = back;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") back(); };
    window.addEventListener("keydown", escape);
    return () => { if (target.__genzoBack === back) delete target.__genzoBack; window.removeEventListener("keydown", escape); };
  }, [ready, busy, declined]);
  useEffect(() => { scroll.current?.scrollTo(0, 0); }, [record?.acceptedAt, declined]);
  function persist(next: OnboardingRecord) {
    try { saveOnboarding(localStorage, next); setError(""); setRecord(next); }
    catch { setError("无法保存本机确认状态，请检查存储空间后重试。保存成功前无法继续。"); }
  }
  function retry() {
    try { setRecord(readOnboarding(localStorage)); setReadFailed(false); setError(""); }
    catch { setReadFailed(true); setError("无法读取本机确认状态，请检查存储空间后重试。"); }
  }
  if (ready) return children;
  // Refactoring UI §2.1 / §2.8: current step and its action lead; the complete
  // agreement and source choices follow; version and later setup stay tertiary.
  // §3.6 / §5.5.1: use the existing spacing scale and shared cool theme tokens.
  return <div ref={root} className="android-app gz-onboarding" data-theme={dark ? "dark" : "light"} data-amoled={amoled ? "true" : "false"} style={{ fontSize: `${16 * fontScale / 100}px`, "--accent-h": accentHue, "--accent-s": `${accentSatValue}%`, "--accent-l": `${dark ? darkAccentLight : lightAccentLight}%`, "--n-s": neutralSatValue, "--n-lift": neutralLiftValue } as CSSProperties}>
    <main ref={scroll} className="gz-onboarding-scroll">
      <div className="gz-onboarding-content">
        <header className="gz-onboarding-heading">
          <div className="gz-onboarding-brand"><Snowflake size={24} aria-hidden="true" /><span>Yuki</span><span>让故事，安静归档</span></div>
          <ol className="gz-onboarding-steps" aria-label="首次使用步骤"><li aria-current={!record ? "step" : undefined}><span>{record ? <Check size={14} aria-hidden="true" /> : "1"}</span>使用须知</li><li aria-current={record ? "step" : undefined}><span>2</span>配置来源</li></ol>
          <h1>{declined ? "尊重你的选择" : record ? sourceCount ? "来源已准备好" : "添加你的第一个来源" : "欢迎，先从安心使用开始"}</h1>
          <p>{declined ? "需要同意使用协议与隐私说明后才能使用 Yuki。你可以重新阅读，或通过系统返回键离开应用。" : record ? "选择你信任的番剧规则。只管理本地媒体，也可以稍后再添加。" : "在收藏第一部作品前，请了解内容来源与你的数据将如何使用。"}</p>
        </header>
        {declined ? <button type="button" className="gz-btn" onClick={() => setDeclined(false)}>重新阅读</button> : record ? <>
          <RuleSourceManager onboarding onChanged={async () => {}} registerBack={registerBack} onBusyChange={setBusy} onCountChange={setSourceCount} />
          <div className="gz-onboarding-tip"><ShieldCheck size={20} aria-hidden="true" /><p>规则可用不代表内容已获授权。请仅使用你有权访问的来源，不会自动安装任何规则。</p></div>
        </> : <><div className="gz-onboarding-summary" aria-label="使用要点"><p><ShieldCheck size={18} aria-hidden="true" /><span>仅使用已获授权的内容</span></p><p><BookOpen size={18} aria-hidden="true" /><span>规则由你选择，来源需自行核实</span></p><p><HardDrive size={18} aria-hidden="true" /><span>资料保存在本机，联网功能会访问对应服务</span></p></div><LegalNotice /></>}
      </div>
    </main>
    {!declined && <footer className="gz-onboarding-footer"><div>
      {error && <p className="gz-error" role="alert">{error}<button type="button" className="gz-link" onClick={retry}>重试</button></p>}
      {!record && <label className="gz-onboarding-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><span>我已阅读并同意《使用协议与隐私说明》</span></label>}
      <div className="gz-onboarding-actions">
        {!record && <button type="button" className="gz-onboarding-decline" onClick={() => { setChecked(false); setDeclined(true); }}>暂不同意</button>}
        <button type="button" className={`gz-btn ${record && !sourceCount ? "gz-onboarding-skip" : "primary"}`} disabled={busy || readFailed || (!record && !checked)} onClick={() => record ? persist({ ...record, completedAt: new Date().toISOString() }) : persist({ agreementVersion: AGREEMENT_VERSION, acceptedAt: new Date().toISOString() })}>
          {record ? sourceCount ? "完成，进入 Yuki" : "暂不添加，进入 Yuki" : "同意并继续"}{record ? <ArrowRight size={18} /> : <FileCheck2 size={18} />}
        </button>
      </div>
      {record && <p className="gz-onboarding-later">{sourceCount ? `已添加 ${sourceCount} 条规则 · ` : ""}之后可在「我的 → 规则设置」管理来源</p>}
    </div></footer>}
  </div>;
}
