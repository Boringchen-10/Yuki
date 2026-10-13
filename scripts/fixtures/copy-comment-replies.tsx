import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ComicComments from "../../src/android/ComicComments";
import { comicExploreApi, novelExploreApi, type CopyComment } from "../../src/comicExplore";
import { androidSession } from "../../src/android/sessionCache";
import "../../src/android/mobile.css";

const qa = window as any;
const calls: any[] = [], pending: (() => void)[] = [];
let behavior = "normal";
const root = createRoot(document.getElementById("root")!);
const comment = (id: number, body: string): CopyComment => ({ id: String(id), comment: body, createAt: "2026-10-13", userId: "synthetic", userName: "合成用户", userAvatar: "", replyCount: 0, parentId: null, parentUserId: null, parentUserName: null });
function replies(book: string, id: string, offset: number) {
  const total = behavior === "empty" ? 0 : id === "202" ? 1 : 25;
  const items = Array.from({ length: Math.min(10, Math.max(0, total - offset)) }, (_, index) => ({
    ...comment(offset === 10 && index === 0 ? 1009 : 1000 + offset + index, `${book} 回复${offset + index} ${index === 0 ? "长正文 ".repeat(45) : "合成回复"}`),
    parentId: id, parentUserName: "合成目标用户",
  }));
  return { items, total, offset, limit: 10 };
}
for (const [kind, api] of [["comic", comicExploreApi], ["novel", novelExploreApi]] as const) {
  api.comments = async book => ({ items: [{ ...comment(101, `${book} 主评论A`), replyCount: 25 }, { ...comment(202, `${book} 主评论B`), replyCount: 1 }], total: 2, offset: 0, limit: 10 });
  api.replies = async (book, id, offset = 0) => {
    calls.push({ kind, book, id, offset });
    if (behavior === "failAppend" && offset === 10 || behavior === "failFirst" && offset === 0) throw new Error("controlled offline");
    const page = replies(book, id, offset);
    if (behavior === "delay") return new Promise(resolve => pending.push(() => resolve(page)));
    return page;
  };
}
qa.__qaCalls = calls;
qa.__qaBehavior = (value: string) => { behavior = value; };
qa.__qaResolve = () => { pending.splice(0).forEach(resolve => resolve()); };
qa.__qaMount = (book = "a", kind: "comic" | "novel" = "comic") => {
  androidSession.invalidate("reading:comments:");
  flushSync(() => root.render(<StrictMode><div className="android-app"><ComicComments pathWord={book} kind={kind} onClose={() => root.render(<div>已关闭</div>)} /></div></StrictMode>));
};
qa.__qaMount();
