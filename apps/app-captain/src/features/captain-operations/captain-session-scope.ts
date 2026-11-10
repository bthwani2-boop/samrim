/** Scope private Captain Order data to one authenticated Identity session, not just its actor. */
export function captainOrderSessionKey(
  state: { kind: string; identity?: { role?: string; subject?: string; sessionId?: string } },
): string {
  if (state.kind !== "authenticated" || state.identity?.role !== "captain") return "";
  const subject = state.identity.subject?.trim();
  const sessionId = state.identity.sessionId?.trim();
  return subject && sessionId ? JSON.stringify([subject, sessionId]) : "";
}

export function isCurrentCaptainActor(loadedActorID: string, activeActorID: string): boolean {
  return loadedActorID.trim().length > 0 && loadedActorID === activeActorID;
}
