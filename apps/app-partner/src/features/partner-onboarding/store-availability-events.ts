type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
/** Invalidates the local readback only. The DSH response remains the sole authority. */
export function onStoreAvailabilityChanged(storeID: string, listener: Listener): () => void {
  const current = listeners.get(storeID) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(storeID, current);
  return () => {
    current.delete(listener);
    if (!current.size) listeners.delete(storeID);
  };
}
export function signalStoreAvailabilityChanged(storeID: string): void {
  for (const listener of listeners.get(storeID) ?? []) listener();
}
