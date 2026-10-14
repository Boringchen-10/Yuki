import { beforeEach, expect, it, vi } from "vitest";
const { invoke, getSetting, setSetting } = vi.hoisted(() => ({ invoke: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../api", () => ({ api: { getSetting, setSetting } }));
import { sortBooks, useBookShelfState } from "./bookShelfState";
import type { WorkListItem } from "../types";
const entry = { hidden: false, browsedAt: null, collectedAt: null };
const book = (id: string, title: string, createdAt: string, updatedAt: string) => ({ id, title, createdAt, updatedAt } as WorkListItem);
beforeEach(() => {
  invoke.mockReset(); getSetting.mockReset(); setSetting.mockReset().mockResolvedValue(undefined);
  useBookShelfState.setState({ entries: {}, loaded: false, order: "collected", favoriteOnly: false });
});
it("orders by shelf entry and real browsing time, independently from metadata updates", () => {
  const items = [book("a", "Beta", "2025-01-01", "2030-01-01"), book("b", "Alpha", "2026-01-01", "2026-01-01")];
  expect(sortBooks(items, "collected", {}).map(item => item.id)).toEqual(["b", "a"]);
  expect(sortBooks(items, "collected", { a: { ...entry, collectedAt: "2027-01-01" } }).map(item => item.id)).toEqual(["a", "b"]);
  expect(sortBooks(items, "browsed", { a: { ...entry, browsedAt: "2024-01-01" } }).map(item => item.id)).toEqual(["a", "b"]);
  expect(sortBooks(items, "name", {}).map(item => item.id)).toEqual(["b", "a"]);
  expect(items.map(item => item.id)).toEqual(["a", "b"]);
});
it("removes optimistically, rolls back failures and restores the same shelf entry", async () => {
  let reject!: (error: Error) => void;
  invoke.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const action = useBookShelfState.getState().event("retained", "remove");
  expect(useBookShelfState.getState().entries.retained?.hidden).toBe(true);
  reject(new Error("write failed")); await expect(action).rejects.toThrow("write failed");
  expect(useBookShelfState.getState().entries.retained?.hidden).toBe(false);
  useBookShelfState.setState({ entries: { retained: { ...entry, hidden: true, browsedAt: "2026-01-01" } } });
  invoke.mockResolvedValue({ ...entry, browsedAt: "2026-01-01", collectedAt: "2026-10-14" });
  await useBookShelfState.getState().event("retained", "restore");
  expect(useBookShelfState.getState().entries.retained?.browsedAt).toBe("2026-01-01");
  expect(invoke).toHaveBeenLastCalledWith("update_book_shelf_state", { workId: "retained", action: "restore" });
});
it("late initial state cannot overwrite a user removal or their filter choice", async () => {
  let resolve!: (value: object) => void;
  invoke.mockImplementation(command => command === "get_book_shelf_state" ? new Promise(yes => { resolve = yes; }) : Promise.resolve({ ...entry, hidden: true }));
  getSetting.mockResolvedValue('{"order":"collected","favoriteOnly":false}');
  const loading = useBookShelfState.getState().load();
  await useBookShelfState.getState().event("retained", "remove");
  useBookShelfState.getState().view("name", true);
  resolve({ retained: entry }); await loading;
  expect(useBookShelfState.getState().entries.retained?.hidden).toBe(true);
  expect(useBookShelfState.getState().order).toBe("name");
  expect(useBookShelfState.getState().favoriteOnly).toBe(true);
});
