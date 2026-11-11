/** A first-Store wizard belongs to one authenticated Partner session, not a device. */
export function partnerSetupSessionKey(
  state: { kind: string; identity?: { role?: string; subject?: string; sessionId?: string } },
): string {
  if (
    state.kind !== "authenticated" ||
    state.identity?.role !== "partner" ||
    !state.identity.subject ||
    !state.identity.sessionId
  ) return "";
  // A structured key cannot collide if actor/session identifiers contain separators.
  return JSON.stringify([state.identity.subject, state.identity.sessionId]);
}
