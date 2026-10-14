import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { episodeArtworkApi } from "../api";

export default function EpisodeStill({ workId, subjectId, episodeKey, url, cached }: { workId?: string; subjectId?: string; episodeKey: string; url?: string; cached?: string }) {
  const image = useRef<HTMLImageElement>(null);
  const identity = `${workId ?? `bangumi:${subjectId}`}:${episodeKey}:${url ?? ""}`;
  const [local, setLocal] = useState<{ identity: string; path: string | null } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const sources = [cached, local?.identity === identity ? local.path : null, url].filter((value): value is string => !!value);
  const src = sources.find(source => !failed.includes(source));
  useEffect(() => {
    if ((!workId && !subjectId) || !url || cached || !image.current) return;
    let disposed = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void (workId ? episodeArtworkApi.cache(workId, episodeKey) : episodeArtworkApi.cacheSubject(subjectId!,episodeKey)).then(path => { if (!disposed) setLocal({ identity, path }); }).catch(() => {});
    }, { rootMargin: "160px" });
    observer.observe(image.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [workId, subjectId, episodeKey, identity, url, cached]);
  return src ? <img ref={image} className="gz-episode-still" src={src} alt="分集剧照" loading="lazy" decoding="async" onError={() => setFailed(previous => [...previous, src])} /> : <Play />;
}
