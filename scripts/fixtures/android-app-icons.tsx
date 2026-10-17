import { useState } from "react";
import { createRoot } from "react-dom/client";
import AppIconPicker from "../../src/android/AppIconPicker";
import { appIconApi, type AppIconId } from "../../src/android/appIcons";
import "../../src/android/mobile.css";

let stored: AppIconId = "classic";
let fail = false;
let calls = 0;
Object.assign(window, { isTauri: true });
appIconApi.get = async () => ({ id: stored });
appIconApi.set = async id => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 150));
  if (fail) throw new Error("受控图标切换失败");
  stored = id;
  return { id };
};
function Fixture() {
  const [key, setKey] = useState(0);
  Object.assign(window, { __iconFail: (value: boolean) => { fail = value; }, __iconCalls: () => calls,
    __iconStored: () => stored, __iconRemount: () => setKey(value => value + 1) });
  return <div className="android-app" data-theme="dark"><main className="gz-scroll"><h1>通用</h1><AppIconPicker key={key} /></main></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
