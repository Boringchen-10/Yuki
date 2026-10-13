import { useEffect, useMemo, useSyncExternalStore } from "react";
import { BANGUMI_NETWORK_CHANGED } from "../bangumiNetwork";
import { createBangumiComments, emptyBangumiComments } from "./bangumiComments";

export function useBangumiComments(subjectId: string | null, enabled = true) {
  const controller = useMemo(() => createBangumiComments(), []);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.open(subjectId, enabled); }, [controller, subjectId, enabled]);
  useEffect(() => {
    // Other listeners invalidate Bangumi metadata during this same event.
    const changed = () => { queueMicrotask(() => { void controller.refresh(); }); };
    window.addEventListener(BANGUMI_NETWORK_CHANGED, changed);
    return () => { window.removeEventListener(BANGUMI_NETWORK_CHANGED, changed); controller.close(); };
  }, [controller]);
  const current = snapshot.subjectId === subjectId ? snapshot : emptyBangumiComments(subjectId);
  const state = subjectId && enabled && current.state === "idle" ? "loading" : current.state;
  return { ...current, state, loadMore: controller.loadMore, retry: controller.retry, retryMore: controller.retryMore, refresh: controller.refresh };
}
