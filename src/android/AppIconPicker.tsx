import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import { getErrorMessage } from "../utils";
import { appIconApi, appIcons, type AppIconId } from "./appIcons";
import "./appIcons.css";

export default function AppIconPicker() {
  const [selected, setSelected] = useState<AppIconId | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const saving = useRef(false);
  const native = isTauri();
  useEffect(() => {
    if (!native) return;
    let active = true;
    void appIconApi.get().then(value => { if (active) setSelected(value.id); })
      .catch(reason => { if (active) setError(getErrorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [native]);
  const select = async (id: AppIconId) => {
    if (saving.current || id === selected) return;
    saving.current = true; setPending(true); setError(""); setMessage("");
    try {
      const value = await appIconApi.set(id);
      setSelected(value.id);
      setMessage("图标已切换，系统桌面可能需要几秒刷新。");
    } catch (reason) {
      setError(getErrorMessage(reason));
      // Re-read native state if an older system applied only part of a switch.
      try { setSelected((await appIconApi.get()).id); } catch { /* Preserve the last confirmed state. */ }
    } finally { saving.current = false; setPending(false); }
  };
  return <section className="gz-block" aria-labelledby="app-icon-heading">
    <h2 id="app-icon-heading" className="gz-block-title">应用图标</h2>
    <div className="gz-block-body gz-app-icon-body">
      <div className="gz-app-icons" role="radiogroup" aria-label="应用图标" aria-busy={pending}>
        {appIcons.map(icon => <button key={icon.id} type="button" role="radio" aria-checked={selected === icon.id}
          disabled={!native || loading || pending} className={`gz-app-icon ${selected === icon.id ? "active" : ""}`} onClick={() => void select(icon.id)}>
          <span className="gz-app-icon-art"><img src={icon.image} alt="" />{selected === icon.id && <Check className="gz-app-icon-check" size={18} aria-hidden="true" />}</span>
          <strong>{icon.label}</strong><span className="gz-meta">{icon.default ? "默认图标" : selected === icon.id ? "当前使用" : "点击切换"}</span>
        </button>)}
      </div>
      <p className="gz-meta">{native ? "仅更换本机桌面图标，选择会自动保存。" : "请在安卓安装版中切换桌面图标。"}</p>
      {pending && <p role="status" className="gz-meta">正在切换图标…</p>}
      {message && <p role="status" className="gz-meta">{message}</p>}
      {error && <p role="alert" className="gz-error">{error}</p>}
    </div>
  </section>;
}
