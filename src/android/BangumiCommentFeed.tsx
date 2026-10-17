import type { BangumiComment } from "../types";
import CommentRate from "./CommentRating";
import BangumiCommentBody from "./BangumiCommentBody";

export function relativeTime(value: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function BangumiCommentFeed({ items }: { items: BangumiComment[] }) {
  return <div className="gz-comment-feed">
    {items.map(comment => <article className="gz-comment-item" key={comment.id}>
      <div className="gz-comment-item-head">
        <span className="gz-comment-avatar">{comment.userName.slice(0, 1) || "匿"}{comment.userAvatar && <img src={comment.userAvatar} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }} />}</span>
        <span className="gz-comment-identity">
          <strong>{comment.userName || "匿名用户"}</strong>
          {relativeTime(comment.createdAt) && <time dateTime={comment.createdAt || undefined}>{relativeTime(comment.createdAt)}</time>}
        </span>
        <CommentRate rate={comment.rate} />
      </div>
      <BangumiCommentBody value={comment.comment} />
    </article>)}
  </div>;
}
