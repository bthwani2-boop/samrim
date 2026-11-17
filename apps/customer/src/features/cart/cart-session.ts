export type CartScope = Readonly<{ actorId: string; sessionId: string; storeId: string }>;
/** A cart may not survive a user/session/Store switch as if it belonged to the current actor. */
export function sameCartScope(left: CartScope | null, right: CartScope | null): boolean {
  return Boolean(left && right && left.actorId && left.sessionId && left.storeId
    && left.actorId === right.actorId && left.sessionId === right.sessionId && left.storeId === right.storeId);
}
