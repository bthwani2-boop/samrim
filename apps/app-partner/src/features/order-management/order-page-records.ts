export function mergeOrderPageRecords<T>(
  current: Readonly<Record<string, T>>,
  page: Readonly<Record<string, T>>,
  append: boolean,
): Readonly<Record<string, T>> {
  return append ? { ...current, ...page } : page;
}

export function tryAcquireOrderAction(locks: Set<string>, orderID: string): (() => void) | null {
  if (locks.has(orderID)) return null;
  locks.add(orderID);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks.delete(orderID);
  };
}
