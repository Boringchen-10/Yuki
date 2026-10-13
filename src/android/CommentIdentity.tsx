export function commentTime(value: string, now = Date.now()): string {
  const stamp = Date.parse(value.trim().replace(" ", "T"));
  if (!Number.isFinite(stamp)) return value;
  const diff = Math.max(0, now - stamp);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  const date = new Date(stamp);
  return `${date.getMonth() + 1}月${date.getDate()}日${date.getFullYear() === new Date(now).getFullYear() ? "" : ` ${date.getFullYear()}`}`;
}

export default function CommentIdentity({ name, avatar, time }: { name: string; avatar: string; time: string }) {
  return <div className="gz-comment-byline">
    <span className="gz-comment-avatar">{name.slice(0, 1) || "匿"}{avatar && <img src={avatar} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }} />}</span>
    <span className="gz-comment-name">{name || "匿名用户"}</span>
    {time && <time className="gz-meta" dateTime={time.replace(" ", "T")} title={time}>{commentTime(time)}</time>}
  </div>;
}
