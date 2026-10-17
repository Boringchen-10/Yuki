import { invoke } from "@tauri-apps/api/core";
import classic from "./assets/app-icons/classic.png";
import beret from "./assets/app-icons/beret.png";
import winter from "./assets/app-icons/winter.png";

export const appIcons = [
  { id: "classic", label: "经典校服", default: true, image: classic },
  { id: "beret", label: "贝雷帽约会", default: false, image: beret },
  { id: "winter", label: "围巾冬装", default: false, image: winter },
] as const;
export type AppIconId = typeof appIcons[number]["id"];
export const appIconApi = {
  get: () => invoke<{ id: AppIconId }>("android_native", { command: "getAppIcon", payload: {} }),
  set: (id: AppIconId) => invoke<{ id: AppIconId }>("android_native", { command: "setAppIcon", payload: { id } }),
};
