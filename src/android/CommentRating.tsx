import "./commentRating.css";

export default function CommentRating({ rate }: { rate: number | null }) {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return <span className="gz-comment-rate" aria-label={`评分 ${rate.toFixed(1)} 分`}>
    {Array.from({ length: 5 }, (_, index) => <i key={index} className="gz-comment-star" aria-hidden="true">★<span style={{ width: `${Math.max(0, Math.min(1, rate / 2 - index)) * 100}%` }}>★</span></i>)}
  </span>;
}
