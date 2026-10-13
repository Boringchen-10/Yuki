import { afterEach, expect, test, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test("rapid navigation skips the previous snapshot and only the latest owns cleanup", async () => {
  const skip = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const remove = vi.fn();
  vi.stubGlobal("document", { querySelectorAll: () => [{style:{removeProperty:remove}}], startViewTransition: vi.fn(() => ({ finished: Promise.resolve(), skipTransition: skip })) });
  const { startAndroidTransition } = await import("./viewTransition");
  const first = startAndroidTransition(() => {});
  const second = startAndroidTransition(() => {});
  expect(skip).toHaveBeenCalledTimes(1);
  expect(first?.isCurrent()).toBe(false);
  expect(second?.isCurrent()).toBe(true);
  await second?.finished;
  expect(remove).toHaveBeenCalledTimes(1);
});

test("reduced motion returns control to the immediate page update", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const native = vi.fn(); vi.stubGlobal("document", { startViewTransition: native });
  const { startAndroidTransition } = await import("./viewTransition");
  expect(startAndroidTransition(() => {})).toBeNull();
  expect(native).not.toHaveBeenCalled();
});

test("detail tabs slide only their content node in the selected direction", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const native = vi.fn(); vi.stubGlobal("document", { startViewTransition: native });
  const cancel = vi.fn(), animate = vi.fn();
  const node = { getAnimations: () => [{ cancel }], animate } as unknown as HTMLElement;
  const commit = vi.fn();
  const { startDetailTabTransition } = await import("./viewTransition");
  startDetailTabTransition("forward", node, commit);
  startDetailTabTransition("back", node, commit);
  expect(commit).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[0]?.[0][0].transform).toBe("translateX(12px)");
  expect(animate.mock.calls[1]?.[0][0].transform).toBe("translateX(-12px)");
  expect(native).not.toHaveBeenCalled();
});

test("detail tabs cancel old motion and update immediately with reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const cancel = vi.fn(), animate = vi.fn(), commit = vi.fn();
  const node = { getAnimations: () => [{ cancel }], animate } as unknown as HTMLElement;
  const { startDetailTabTransition } = await import("./viewTransition");
  expect(startDetailTabTransition("back", node, commit)).toBeNull();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(animate).not.toHaveBeenCalled();
});
