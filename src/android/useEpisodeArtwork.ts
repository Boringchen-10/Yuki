import { useCallback, useEffect, useRef, useState } from "react";
import { episodeArtworkApi } from "../api";
import type { EpisodeArtwork } from "../episodeArtwork";
import { androidSession } from "./sessionCache";

export function useEpisodeArtwork(workId: string | undefined, signature: string, subjectId?: string) {
  const [snapshot, setSnapshot] = useState<{key:string;value:EpisodeArtwork} | null>(null);
  const [warning, setWarning] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const key = `episode-artwork:${workId ?? `bangumi:${subjectId}`}:${signature}`;
  const read = useCallback((fresh = false) => workId ? episodeArtworkApi.refresh(workId, fresh) : episodeArtworkApi.subject(subjectId!, fresh), [workId, subjectId]);
  useEffect(() => {
    const request = ++generation.current; let refreshed = false;
    setSnapshot(null); setWarning(""); setRefreshing(false);
    if ((!workId && !subjectId) || !signature) return;
    if (workId) void episodeArtworkApi.get(workId).then(cached => { if (request === generation.current && !refreshed) setSnapshot({key,value:cached}); }).catch(() => {});
    void androidSession.load(key, () => read()).then(value => {
      if (request === generation.current) { refreshed = true; setSnapshot({key,value}); setWarning(value.warnings.join("；")); }
    }).catch(() => { if (request === generation.current) setWarning("剧照暂时无法更新，可稍后重试。"); });
    return () => { generation.current++; };
  }, [workId, subjectId, signature, key, read]);
  const refresh = useCallback(async () => {
    if ((!workId && !subjectId) || !signature) return;
    const request = ++generation.current;
    setRefreshing(true); setWarning("");
    try {
      const value = await read(true);
      if (request !== generation.current) return;
      setSnapshot({key,value}); setWarning(value.warnings.join("；")); androidSession.set(key, value);
    } catch { if (request === generation.current) setWarning("剧照暂时无法更新，可稍后重试。"); }
    finally { if (request === generation.current) setRefreshing(false); }
  }, [workId, subjectId, signature, key, read]);
  return { artwork: snapshot?.key===key ? snapshot.value : null, warning, refreshing, refresh };
}
