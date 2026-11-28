// Catalog mutation recovery has a single exclusion mechanism per platform.
// A process-local Promise queue cannot coordinate independent browser tabs.
const nativeQueues = new Map<string, Promise<void>>();

export function withCatalogRecoveryLock<T>(
  platform: string, key: string, action: () => Promise<T>,
): Promise<T> {
  if (platform === "web") {
    const locks = window.navigator?.locks;
    if (!locks) return Promise.reject(new Error("CATALOG_RECOVERY_LOCK_UNAVAILABLE"));
    return locks.request(key, action);
  }
  const result = (nativeQueues.get(key) ?? Promise.resolve()).then(action);
  const tail = result.then(() => undefined, () => undefined);
  nativeQueues.set(key, tail);
  void tail.then(() => {
    if (nativeQueues.get(key) === tail) nativeQueues.delete(key);
  });
  return result;
}
