import { useEffect, useRef, type RefObject } from "react";

/** Observe within the actual sheet scroll area; errors pause until explicit retry. */
export default function AutoLoadSentinel({ enabled, load, scrollRoot }: { enabled: boolean; load: () => void; scrollRoot?: RefObject<HTMLElement | null> }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = target.current;
    if (!enabled || !node) return;
    const root = scrollRoot?.current ?? node.closest<HTMLElement>(".gz-comments-list");
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load(); }, { root, rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, load, scrollRoot]);
  return <div ref={target} className="gz-sentinel" aria-hidden="true" />;
}
