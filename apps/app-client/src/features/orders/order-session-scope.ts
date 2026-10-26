export function clientOrderAuthenticationReturnPath(orderID: string): string {
  const normalizedOrderID = orderID.trim();
  return normalizedOrderID ? `/orders/${encodeURIComponent(normalizedOrderID)}` : "/orders";
}

export function isClientActorScopeCurrent(loadedActorID: string, activeActorID: string): boolean {
  return loadedActorID.trim().length > 0 && loadedActorID === activeActorID;
}

export function isClientOrderScopeCurrent(
  loadedActorID: string,
  loadedOrderID: string,
  activeActorID: string,
  requestedOrderID: string,
): boolean {
  return isClientActorScopeCurrent(loadedActorID, activeActorID)
    && loadedOrderID.length > 0
    && loadedOrderID === requestedOrderID;
}
