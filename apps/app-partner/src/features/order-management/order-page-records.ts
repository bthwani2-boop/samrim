export function mergeOrderPageRecords<T>(
  current: Readonly<Record<string, T>>,
  page: Readonly<Record<string, T>>,
  append: boolean,
): Readonly<Record<string, T>> {
  return append ? { ...current, ...page } : page;
}

export function isCurrentOrderListRequest(
  generation: number,
  scopeKey: string,
  currentGeneration: number,
  currentScopeKey: string,
): boolean {
  return generation === currentGeneration && scopeKey === currentScopeKey;
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

/**
 * A page GET may have started before a partner PATCH committed. Keep the
 * newer durable order version already acknowledged by the same Store view,
 * while treating a fresh successful page as authoritative about membership.
 */
export function reconcileVersionedOrderPage<T extends Readonly<{ orderId: string; version: number }>>(
  current: ReadonlyArray<T>,
  page: ReadonlyArray<T>,
  append: boolean,
): ReadonlyArray<T> {
  const byID = new Map<string, T>();
  for (const order of append ? [...current, ...page] : page) {
    const existing = byID.get(order.orderId);
    if (!existing || order.version >= existing.version) byID.set(order.orderId, order);
  }
  if (!append) {
    for (const order of current) {
      const read = byID.get(order.orderId);
      if (read && order.version > read.version) byID.set(order.orderId, order);
    }
  }
  return [...byID.values()];
}
