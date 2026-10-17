import { createRoot } from "react-dom/client";
import AppUpdatePanel from "../../src/android/AppUpdatePanel";
import "../../src/android/mobile.css";

const qa = window as any;
let status = { phase: "idle", currentVersion: "0.17.0", version: "", bytes: 0, total: 0, error: "", canInstall: false };
qa.isTauri = true;
qa.__calls = [];
qa.__setUpdate = (patch: any) => { status = { ...status, ...patch }; };
qa.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
  qa.__calls.push(args.command);
  if (command !== "android_native") throw new Error("Unexpected command");
  if (args.command === "checkAppUpdate") status = { ...status, phase: "available", version: "0.18.0", total: 50 * 1024 * 1024, error: "" };
  if (args.command === "downloadAppUpdate") status = { ...status, phase: "downloading", bytes: 10 * 1024 * 1024 };
  if (args.command === "cancelAppUpdate") status = { ...status, phase: "available", bytes: 0 };
  if (args.command === "installAppUpdate") status = { ...status, phase: "permission" };
  return { ...status };
} };
createRoot(document.getElementById("root")!).render(<div className="android-app" data-theme="dark"><main className="gz-scroll"><AppUpdatePanel /></main></div>);
