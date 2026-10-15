import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import BangumiCommentFeed from "../../src/android/BangumiCommentFeed";
import { api } from "../../src/api";
import { androidSession } from "../../src/android/sessionCache";
import "../../src/android/mobile.css";

const qa = window as any;
const root = createRoot(document.getElementById("root")!);
const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
const paint = canvas.getContext("2d")!;
paint.fillStyle = "#456c5d"; paint.fillRect(0, 0, 640, 360);
paint.fillStyle = "#a9c7b9"; paint.fillRect(40, 40, 240, 280);
paint.fillStyle = "#f1b97e"; paint.fillRect(320, 40, 280, 120);
paint.fillStyle = "#d4dce1"; paint.fillRect(320, 200, 280, 120);
const image = canvas.toDataURL("image/png");
const calls: string[] = [];
const pending: (() => void)[] = [];
let fail = true;
api.bangumiCommentImage = async url => {
  calls.push(url);
  if (url.includes("fail") && fail) throw new Error("controlled unavailable image");
  if (url.includes("late")) return new Promise(resolve => pending.push(() => resolve(image)));
  return image;
};
qa.__qaCalls = calls;
qa.__qaRetry = () => { fail = false; };
qa.__qaResolve = () => { pending.splice(0).forEach(resolve => resolve()); };
qa.__qaMount = (mode = "normal") => {
  androidSession.invalidate("bangumi:comment-image:");
  const body = mode === "normal" ? "图片前正文\n[IMG=176,99] \n//lain.bgm.tv/a.jpg\n[/IMG]\n图片间正文\n[img]https://i.postimg.cc/b.png[/img]\n图片后正文"
    : mode === "plain" ? '<img src="https://example.org/unsafe.png"> [img]file:///secret[/img] 普通文字'
      : `[img]https://i.imgur.com/${mode}.png[/img]`;
  flushSync(() => root.render(<StrictMode><div className="android-app" style={{ minHeight: "100vh", padding: 16, background: "#0d1612", color: "#e6ebe7", boxSizing: "border-box" }}>
    <BangumiCommentFeed items={[{ id: mode, userName: "合成评论用户", userAvatar: null, createdAt: "2026-10-14T10:00:00Z", comment: body, rate: 7 }]} />
  </div></StrictMode>));
};
qa.__qaMount();
