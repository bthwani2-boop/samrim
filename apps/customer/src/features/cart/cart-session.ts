import { type CustomerCartChange, DshCartError, prepareCustomerCartChange } from "@bthwani/dsh";

type PendingAttempt = { readonly change: CustomerCartChange; sending: boolean };

// DSH binds the operation identity to its payload. Keep one immutable
// dispatch snapshot per verified Customer and Store across app screens.
const pendingAttempts = new Map<string, PendingAttempt>();

function scopeKey(actorId: string, storeId: string): string {
  return JSON.stringify([actorId, storeId]);
}

function matchesChange(original: CustomerCartChange, proposed: CustomerCartChange): boolean {
  return original.operationId === proposed.operationId &&
    original.expectedVersion === proposed.expectedVersion &&
    original.lines.length === proposed.lines.length &&
    original.lines.every((line, index) => {
      const other = proposed.lines[index];
      return other !== undefined && line.offerId === other.offerId && line.quantity === other.quantity;
    });
}

export function pendingCartChange(actorId: string, storeId: string): CustomerCartChange | undefined {
  return pendingAttempts.get(scopeKey(actorId, storeId))?.change;
}

export async function withPendingCartChange<T>(
  actorId: string,
  storeId: string,
  change: CustomerCartChange,
  send: (change: CustomerCartChange) => Promise<T>,
): Promise<T> {
  const key = scopeKey(actorId, storeId);
  const retained = pendingAttempts.get(key);
  const conflict = () => new DshCartError(409, "CART_PENDING_RECONCILIATION");
  if (retained?.sending) throw conflict();
  let admitted: CustomerCartChange;
  try {
    admitted = prepareCustomerCartChange(change);
  } catch (error) {
    if (retained) throw conflict();
    throw error;
  }
  if (retained && !matchesChange(retained.change, admitted)) throw conflict();

  const attempt = retained ?? { change: admitted, sending: false };
  pendingAttempts.set(key, attempt);
  attempt.sending = true;

  try {
    const result = await send(attempt.change);
    pendingAttempts.delete(key);
    return result;
  } catch (error) {
    // A definitive rejection releases the command for owner readback.
    // Lost receipts or authorization cannot prove an earlier dispatch failed.
    if (error instanceof DshCartError && [400, 404, 409].includes(error.status)) {
      pendingAttempts.delete(key);
    }
    throw error;
  } finally {
    attempt.sending = false;
  }
}
