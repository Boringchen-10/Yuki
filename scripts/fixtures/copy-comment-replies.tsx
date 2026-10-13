import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ComicComments from "../../src/android/ComicComments";
import CommentRating from "../../src/android/CommentRating";
import { comicExploreApi, novelExploreApi, type CopyComment } from "../../src/comicExplore";
import { androidSession } from "../../src/android/sessionCache";
import "../../src/android/mobile.css";

const qa = window as any;
const calls: any[] = [], pending: (() => void)[] = [];
let behavior = "normal", commentBehavior = "normal";
const root = createRoot(document.getElementById("root")!);
const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="#748080"/><circle cx="20" cy="15" r="7" fill="#eef0ed"/><path d="M8 36a12 12 0 0 1 24 0" fill="#eef0ed"/></svg>')}`;
const comment = (id: number, body: string): CopyComment => ({ id: String(id), comment: body, createAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), userId: "synthetic", userName: "合成用户", userAvatar: avatar, replyCount: 0, parentId: null, parentUserId: null, parentUserName: null });
function comments(book: string, offset: number) {
  const total = 22;
  const items = Array.from({ length: Math.min(10, total - offset) }, (_, index) => {
    const sourceIndex = offset + index;
    const id = sourceIndex === 0 ? 101 : sourceIndex === 1 ? 202 : sourceIndex === 10 ? 309 : 300 + sourceIndex;
    return { ...comment(id, `${book} ${sourceIndex === 0 ? "主评论A" : sourceIndex === 1 ? "主评论B" : `主评论${sourceIndex}`} ${sourceIndex > 1 ? "合成评论内容，用于检查滚动分页与窄屏排版。".repeat(2) : ""}`.trim()), replyCount: sourceIndex === 0 ? 25 : sourceIndex === 1 ? 1 : 0 };
  });
  return { items: commentBehavior === "noProgress" && offset > 0 ? [] : items, total, offset, limit: 10 };
}
function replies(book: string, id: string, offset: number) {
  const total = behavior === "empty" ? 0 : id === "202" ? 1 : 25;
  const items = Array.from({ length: Math.min(10, Math.max(0, total - offset)) }, (_, index) => ({
    ...comment(offset === 10 && index === 0 ? 1009 : 1000 + offset + index, `${book} 回复${offset + index} ${index === 0 ? "长正文 ".repeat(45) : "合成回复"}`),
    parentId: id, parentUserName: "合成目标用户",
  }));
  return { items: behavior === "noProgress" && offset > 0 ? [] : items, total, offset, limit: 10 };
}
for (const [kind, api] of [["comic", comicExploreApi], ["novel", novelExploreApi]] as const) {
  api.comments = async (book, offset = 0) => {
    calls.push({ scope: "comments", kind, book, offset });
    if (commentBehavior === "failAppend" && offset === 10) throw new Error("controlled offline");
    const page = comments(book, offset);
    if (commentBehavior === "delay") return new Promise(resolve => pending.push(() => resolve(page)));
    return page;
  };
  api.replies = async (book, id, offset = 0) => {
    calls.push({ scope: "replies", kind, book, id, offset });
    if (behavior === "failAppend" && offset === 10 || behavior === "failFirst" && offset === 0) throw new Error("controlled offline");
    const page = replies(book, id, offset);
    if (behavior === "delay") return new Promise(resolve => pending.push(() => resolve(page)));
    return page;
  };
}
qa.__qaCalls = calls;
qa.__qaBehavior = (value: string, scope = "replies") => { if (scope === "comments") commentBehavior = value; else behavior = value; };
qa.__qaResolve = () => { pending.splice(0).forEach(resolve => resolve()); };
qa.__qaMount = (book = "a", kind: "comic" | "novel" = "comic") => {
  androidSession.invalidate("reading:comments:");
  flushSync(() => root.render(<StrictMode><div className="android-app"><ComicComments pathWord={book} kind={kind} onClose={() => root.render(<div>已关闭</div>)} /></div></StrictMode>));
};
qa.__qaRating = () => flushSync(() => root.render(<div className="android-app"><div data-qa="seven"><CommentRating rate={7} /></div><div data-qa="unrated"><CommentRating rate={null} /><CommentRating rate={0} /></div></div>));
qa.__qaMount();
