import { type CustomerCartChange, DshCartError } from "@bthwani/dsh";

export type CartScope = Readonly<{ actorId: string; sessionId: string; storeId: string }>;
/** A cart may not survive a user/session/Store switch as if it belonged to the current actor. */
export function sameCartScope(left: CartScope | null, right: CartScope | null): boolean {
  return Boolean(left && right && left.actorId && left.sessionId && left.storeId
    && left.actorId === right.actorId && left.sessionId === right.sessionId && left.storeId === right.storeId);
}

// Recover the original command across screens while this app process is open.
// Callers look up attempts only after verifying the current Customer and Store.
const attempts = new Map<string, { change: CustomerCartChange; sending: boolean }>();
const attemptKey = (actorId: string, storeId: string) => JSON.stringify([actorId, storeId]);

export function pendingCartChange(actorId: string, storeId: string): CustomerCartChange | undefined {
  return attempts.get(attemptKey(actorId, storeId))?.change;
}

export async function withPendingCartChange<T>(
  actorId: string, storeId: string, change: CustomerCartChange,
  send: (change: CustomerCartChange) => Promise<T>,
): Promise<T> {
  const key = attemptKey(actorId, storeId);
  const existing = attempts.get(key);
  if (existing && (existing.sending || existing.change !== change)) {
    throw new DshCartError(409, "CART_PENDING_RECONCILIATION");
  }
  const attempt = existing ?? { change, sending: false };
  attempts.set(key, attempt);
  attempt.sending = true;
  try {
    const result = await send(attempt.change);
    attempts.delete(key);
    return result;
  } catch (error) {
    // A conflict requires fresh owner readback. Authorization and transport
    // failures cannot establish the outcome of an earlier dispatch.
    if (error instanceof DshCartError && [400, 404, 409].includes(error.status)) attempts.delete(key);
    throw error;
  } finally {
    attempt.sending = false;
  }
}
