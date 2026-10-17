import type { AnimeCharacter } from "../types";

const ROLE_RANK: Record<string, number> = { "主角": 0, "配角": 1, "客串": 2 };

function roleRank(role: string): number {
  const rank = ROLE_RANK[role];
  if (rank !== undefined) return rank;
  return role ? 3 : 4;
}

export default function AnimeCharacters({ characters }: { characters: AnimeCharacter[] }) {
  const ordered = [...characters].sort((a, b) => roleRank(a.role) - roleRank(b.role));
  return <div className="gz-char-list">
    {ordered.map(character => <div className="gz-char" key={character.externalId}>
      <span className="gz-char-avatar">
        <span className="gz-char-initial" aria-hidden="true">{character.name.slice(0, 1)}</span>
        {character.imageUrl && <img src={character.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={event => { event.currentTarget.hidden = true; }} />}
      </span>
      <span className="gz-char-main">
        <strong>{character.name}</strong>
        <span>{character.actors.length ? character.actors.join(" / ") : "—"}</span>
      </span>
      <span className="gz-char-role">{character.role || "未知"}</span>
    </div>)}
  </div>;
}
