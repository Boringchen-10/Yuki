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

let panelSeq = 0;

/**
 * In-place content swap (tab / sub-view changes) within a single page.
 * Animates only the named content region, so bar chrome (tab bar, page header)
 * stays still — the same behaviour the bookshelf uses between its sections.
 */
export function startPanelTransition(
  kind: "forward" | "back",
  node: HTMLElement | null,
  commit: () => void,
  name = "gz-panel",
) {
  const root = document.documentElement;
  const seq = ++panelSeq;
  let named: HTMLElement | null = null;
  if (node) { node.style.setProperty("view-transition-name", name); named = node; }
  // The body snapshot is as tall as the content and is composited above the page,
  // so it would paint over the bottom bar. Naming the bar gives it its own static
  // group, ordered after the body in tree order, which keeps it visible and fixed.
  const bar = document.querySelector<HTMLElement>(".gz-tabbar");
  bar?.style.setProperty("view-transition-name", "gz-tabbar");
  root.dataset.trans = "panel"; root.dataset.nav = kind;
  // A rapid second tap skips the previous transition; its cleanup resolves
  // later and must not strip the name off the transition that is now running.
  const clear = () => {
    if (seq !== panelSeq) return;
    named?.style.removeProperty("view-transition-name");
    bar?.style.removeProperty("view-transition-name");
    delete root.dataset.trans; delete root.dataset.nav;
  };
  const transition = startAndroidTransition(() => flushSync(commit));
  if (!transition) {
    flushSync(commit);
    if (named) {
      const fallback = `gz-panel-fallback-${kind}`;
      named.classList.remove("gz-panel-fallback-forward", "gz-panel-fallback-back");
      void named.offsetWidth;
      named.classList.add(fallback);
      window.setTimeout(() => named?.classList.remove(fallback), 320);
    }
    clear();
    return null;
  }
  void transition.finished.then(clear, clear);
  return transition;
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
