export type SessionScope = Readonly<{ actorId: string; sessionId: string }>;

export function sameSessionScope(left: SessionScope | null, right: SessionScope | null): boolean {
  return Boolean(left && right && left.actorId && left.sessionId && left.actorId === right.actorId && left.sessionId === right.sessionId);
}
