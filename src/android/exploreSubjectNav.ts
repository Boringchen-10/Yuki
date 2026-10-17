type Listener = (externalId: string) => void;

const listeners = new Set<Listener>();
let pending: string | null = null;

export function requestExploreSubject(externalId: string): void {
  if (listeners.size === 0) { pending = externalId; return; }
  listeners.forEach(listener => listener(externalId));
}

export function onExploreSubjectRequest(listener: Listener): () => void {
  listeners.add(listener);
  if (pending !== null) { const value = pending; pending = null; listener(value); }
  return () => { listeners.delete(listener); };
}
