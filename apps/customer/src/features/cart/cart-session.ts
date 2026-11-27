import { type CustomerCartChange, DshCartError } from "@bthwani/dsh";

type PendingAttempt = { readonly change: CustomerCartChange; sending: boolean };

// DSH binds the operation identity to its payload. Keep one immutable
// dispatch snapshot per verified Customer and Store across app screens.
const pendingAttempts = new Map<string, PendingAttempt>();

function scopeKey(actorId: string, storeId: string): string {
  return JSON.stringify([actorId, storeId]);
}

function captureChange(change: CustomerCartChange): CustomerCartChange {
  const lines = change.lines.map(line => Object.freeze({ offerId: line.offerId, quantity: line.quantity }));
  Object.freeze(lines);
  return Object.freeze({ operationId: change.operationId, expectedVersion: change.expectedVersion, lines });
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
  if (retained && (retained.sending || !matchesChange(retained.change, change))) {
    throw new DshCartError(409, "CART_PENDING_RECONCILIATION");
  }

  const attempt = retained ?? { change: captureChange(change), sending: false };
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
