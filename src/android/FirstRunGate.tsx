import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, FileCheck2, Package, Snowflake } from "lucide-react";
import { androidApi } from "./api";
import { usePreferences } from "../store";
import { nativeAppearance } from "./nativeAppearance";
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
  const root = useRef<HTMLDivElement>(null), scroll = useRef<HTMLElement>(null);
  const subviewBack = useRef<(() => boolean) | null>(null);
  const registerBack = useRef((handler: (() => boolean) | null) => { subviewBack.current = handler; }).current;
  const theme = usePreferences(state => state.theme), fontScale = usePreferences(state => state.fontScale);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const ready = !!record?.completedAt;
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
    void androidApi.appearance(dark, nativeAppearance(root.current, theme, 28, 55)).catch(() => {});
  }, [ready, dark, theme]);
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
  return <div ref={root} className="android-app gz-onboarding" data-theme={dark ? "dark" : "light"} style={{ fontSize: `${16 * fontScale / 100}px`, "--accent-l": dark ? "55%" : "28%" } as CSSProperties}>
    <main ref={scroll} className="gz-onboarding-scroll">
      <div className="gz-onboarding-content">
        <header className="gz-onboarding-heading">
          <span className="gz-onboarding-mark" aria-hidden="true"><Snowflake size={30} /></span>
          <p className="gz-meta">欢迎使用 Yuki · {record ? "02 / 添加来源" : "01 / 使用前须知"}</p>
          <h1>{declined ? "尊重你的选择" : record ? "让故事有个来源" : "开始之前，请先阅读"}</h1>
          <p>{declined ? "需要同意使用协议与隐私说明后才能使用 Yuki。你可以重新阅读，或通过系统返回键离开应用。" : record ? "从规则仓库选择所需规则，或导入你信任的规则。不会自动安装任何规则。" : "了解内容来源、使用责任与数据去向，再开始整理你的收藏。"}</p>
        </header>
        {declined ? <button type="button" className="gz-btn" onClick={() => setDeclined(false)}>重新阅读</button> : record ? <>
          <div className="gz-onboarding-tip"><Package size={20} /><p>规则只描述如何访问第三方站点，不代表内容授权。仅使用你有权访问的来源；本地媒体无需规则。</p></div>
          <RuleSourceManager onChanged={async () => {}} registerBack={registerBack} onBusyChange={setBusy} />
          <p className="gz-meta">可以稍后在「我的 → 规则设置」继续添加、导入和管理规则。</p>
        </> : <LegalNotice />}
      </div>
    </main>
    {!declined && <footer className="gz-onboarding-footer"><div>
      {error && <p className="gz-error" role="alert">{error}<button type="button" className="gz-link" onClick={retry}>重试</button></p>}
      {!record && <label className="gz-onboarding-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><span>我已阅读并同意《使用协议与隐私说明》</span></label>}
      <div className="gz-onboarding-actions">
        {!record && <button type="button" className="gz-btn" onClick={() => { setChecked(false); setDeclined(true); }}>暂不同意</button>}
        <button type="button" className="gz-btn primary" disabled={busy || readFailed || (!record && !checked)} onClick={() => record ? persist({ ...record, completedAt: new Date().toISOString() }) : persist({ agreementVersion: AGREEMENT_VERSION, acceptedAt: new Date().toISOString() })}>
          {record ? "进入 Yuki（可稍后添加）" : "同意并继续"}{record ? <ArrowRight size={18} /> : <FileCheck2 size={18} />}
        </button>
      </div>
    </div></footer>}
  </div>;
}
