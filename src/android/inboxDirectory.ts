import type { UnassignedMediaGroup } from "../types";

export function inboxDirectory(group: UnassignedMediaGroup): string[] {
  const folder = (group.folderPath ?? "").replace(/\\/g, "/");
  const source = group.representative.libraryRootId;
  const virtual = folder.match(/^(?:webdav|saf):\/+([^/]+)\/?(.*)$/);
  return (virtual?.[1] === source ? virtual[2] ?? "" : folder).split("/").filter(Boolean);
}

export function inInboxDirectory(group: UnassignedMediaGroup, source: string, path: string[]) {
  const directory = inboxDirectory(group);
  return group.representative.libraryRootId === source && path.every((part, index) => directory[index] === part);
}
