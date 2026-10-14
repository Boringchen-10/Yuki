export type ExploreTagTarget = { kind: "anime" | "comic" | "novel"; tag: string };
export const EXPLORE_TAG_EVENT = "genzo-explore-tag";
let pending: ExploreTagTarget | null = null;

export function requestExploreTag(target: ExploreTagTarget) {
  const tag = target.tag.trim();
  if (!tag) return;
  pending = { ...target, tag };
  window.dispatchEvent(new Event(EXPLORE_TAG_EVENT));
}
export const peekExploreTag = () => pending;
export function takeExploreTag() {
  const target = pending;
  pending = null;
  return target;
}
