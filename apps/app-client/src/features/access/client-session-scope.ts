/** Exact Client Identity actor and login-session scope; shared by private UI features. */
export function clientSessionKey(
  state: { kind: string; identity?: { role?: string; subject?: string; sessionId?: string } },
): string {
  if (state.kind !== "authenticated" || state.identity?.role !== "client") return "";
  const subject = state.identity.subject?.trim();
  const sessionId = state.identity.sessionId?.trim();
  return subject && sessionId ? JSON.stringify([subject, sessionId]) : "";
}
