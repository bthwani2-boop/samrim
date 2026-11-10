/** Derive the exact Client actor/session scope for private Order views. */
export function clientOrderSessionKey(
  state: { kind: string; identity?: { role?: string; subject?: string; sessionId?: string } },
): string {
  if (state.kind !== "authenticated" || state.identity?.role !== "client") return "";
  const subject = state.identity.subject?.trim();
  const sessionId = state.identity.sessionId?.trim();
  return subject && sessionId ? JSON.stringify([subject, sessionId]) : "";
}

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
