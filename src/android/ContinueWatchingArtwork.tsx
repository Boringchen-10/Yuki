import { useEffect, useRef, useState } from "react";
import { episodeArtworkApi } from "../api";
import type { EpisodeArtwork } from "../episodeArtwork";
import EpisodeStill from "./EpisodeStill";
import { androidSession } from "./sessionCache";

export default function ContinueWatchingArtwork({ workId, episodeKey }: { workId: string | null; episodeKey?: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const identity = `${workId}:${episodeKey}`;
  const [loaded, setLoaded] = useState<{ identity: string; artwork: EpisodeArtwork } | null>(null);
  useEffect(() => {
    if (!workId || !episodeKey || !root.current) return;
    let active = true;
    const key = `continue-artwork:${workId}`;
    const accept = (artwork: EpisodeArtwork) => { if (active) setLoaded({ identity, artwork }); };
    void androidSession.load(`${key}:cached`, () => episodeArtworkApi.get(workId)).then(accept).catch(() => {});
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void androidSession.load(`${key}:refresh`, () => episodeArtworkApi.refresh(workId)).then(accept).catch(() => {});
    }, { rootMargin: "160px" });
    observer.observe(root.current);
    return () => { active = false; observer.disconnect(); };
  }, [workId, episodeKey, identity]);
  const artwork = loaded?.identity === identity ? loaded.artwork : null;
  return <div ref={root} className="gz-continue-artwork"><EpisodeStill workId={workId ?? undefined} episodeKey={episodeKey ?? ""} url={episodeKey ? artwork?.images[episodeKey] : undefined} cached={episodeKey ? artwork?.cachedImages[episodeKey] : undefined} /></div>;
}
