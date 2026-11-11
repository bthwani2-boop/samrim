/** Exact Client Identity actor and login-session scope; shared by private UI features. */
export function clientSessionKey(
  state: { kind: string; identity?: { role?: string; subject?: string; sessionId?: string } },
): string {
  if (state.kind !== "authenticated" || state.identity?.role !== "client") return "";
  const subject = state.identity.subject?.trim();
  const sessionId = state.identity.sessionId?.trim();
  return subject && sessionId ? JSON.stringify([subject, sessionId]) : "";
}

/** A cached list belongs only to the actor who loaded it (not authorization to mutate). */
export function isClientActorScopeCurrent(loadedActorID: string, activeActorID: string): boolean {
  return loadedActorID.trim().length > 0 && loadedActorID === activeActorID;
}

/** Reject an old Order response after the actor or selected Order changes. */
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
