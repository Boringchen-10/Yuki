import type { AnimeSeasonOption } from "../types";

export default function AnimeRelated({ seasons, onOpen }: { seasons: AnimeSeasonOption[]; onOpen: (season: AnimeSeasonOption) => void }) {
  return <div className="gz-related-list">
    {seasons.map(season => <button type="button" className={`gz-related${season.current ? " is-current" : ""}`} key={season.externalId} onClick={() => onOpen(season)}>
      <span className="gz-related-cover">
        {season.coverUrl
          ? <img src={season.coverUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={event => { event.currentTarget.hidden = true; }} />
          : <span className="gz-related-initial" aria-hidden="true">{season.title.slice(0, 1)}</span>}
      </span>
      <span className="gz-related-main">
        <strong>{season.title}</strong>
        <span className="gz-related-relation">{season.current ? "当前作品" : season.relation}{season.seasonNumber && !season.current ? ` · 第 ${season.seasonNumber} 季` : ""}</span>
      </span>
    </button>)}
  </div>;
}
