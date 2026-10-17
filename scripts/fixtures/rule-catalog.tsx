import { useState } from "react";
import { createRoot } from "react-dom/client";
import RuleSourceManager from "../../src/android/RuleSourceManager";
import { rulesApi, type RulePlugin } from "../../src/android/rulesApi";
import "../../src/android/mobile.css";

let fail = true;
const plugins: RulePlugin[] = [{ id: "old-rule", name: "API9", version: "1.0", enabled: false, origin: "https://example.org/API9.json", updatedAt: "2026-10-17" }];
rulesApi.plugins = async () => structuredClone(plugins);
rulesApi.catalog = async () => ({ items: [{ name: "API9", version: "2.0" }, ...Array.from({ length: 60 }, (_, i) => ({ name: `VeryLongRuleName${i}`, version: "1.0" }))], stale: false });
rulesApi.install = async () => { await new Promise(resolve => setTimeout(resolve, 40)); if (fail) throw new Error("无效输入：目前支持 Kazumi API 1–8 规则"); plugins[0].version = "2.0"; return "old-rule"; };
function Fixture() {
  const [, changed] = useState(0);
  Object.assign(window, { __catalogFail: (next: boolean) => { fail = next; }, __plugins: () => structuredClone(plugins) });
  return <div className="android-app" data-theme="dark" style={{ "--safe-top": "38px", "--safe-bottom": "24px" } as React.CSSProperties}>
    <main className="gz-scroll"><RuleSourceManager onChanged={async () => changed(value => value + 1)} registerBack={() => {}} /></main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
