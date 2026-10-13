import { flushSync } from "react-dom";

type Transition = { finished: Promise<void>; skipTransition(): void };
let active: Transition | null = null;
let generation = 0;

/** One snapshot animation at a time across the library and discovery views. */
export function startAndroidTransition(callback: () => void | Promise<void>) {
  const current = ++generation;
  active?.skipTransition();
  active = null;
  const doc = document as Document & { startViewTransition?: (update: () => void | Promise<void>) => Transition };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  try {
    const transition = doc.startViewTransition(callback);
    active = transition;
    const release = () => {
      if (current !== generation) return;
      active = null;
      document.querySelectorAll<HTMLElement>("[data-cover-id], [data-explore-cover-id], .gz-scroll").forEach(node => node.style.removeProperty("view-transition-name"));
    };
    void transition.finished.then(release,release);
    return { finished: transition.finished, isCurrent: () => current === generation };
  } catch { return null; }
}

/** Detail tabs animate only the content below the stationary hero and tab bar. */
export function startDetailTabTransition(kind: "forward" | "back", node: HTMLElement | null, commit: () => void) {
  node?.getAnimations().forEach(animation => animation.cancel());
  flushSync(commit);
  if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  return node.animate([
    { opacity: 0, transform: `translateX(${kind === "forward" ? 12 : -12}px)` },
    { opacity: 1, transform: "none" },
  ], { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" });
}
