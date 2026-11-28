import { type PendingRegistration, parsePendingRegistration } from "@bthwani/dsh";

// A settled marker is not a pending command. Retaining its opaque generation
// prevents an older mounted form from interpreting settlement as a fresh slot.
export type StoredMerchantRegistration = PendingRegistration & { readonly settled?: true };

export function parseStoredMerchantRegistration(raw: string | null): StoredMerchantRegistration | null {
  if (raw === null) return null;
  const pending = parsePendingRegistration(raw);
  if (pending) return pending;
  const value: unknown = JSON.parse(raw);
  if (value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 3 && "settled" in value && value.settled === true &&
      "fingerprint" in value && "operationId" in value) {
    const record = parsePendingRegistration(JSON.stringify({ fingerprint: value.fingerprint, operationId: value.operationId }));
    if (record) return { ...record, settled: true };
  }
  throw new Error("Invalid Store registration recovery metadata");
}

export function sameRegistrationGeneration(a: StoredMerchantRegistration | null, b: StoredMerchantRegistration | null): boolean {
  return a === null || b === null ? a === b :
    a.operationId === b.operationId && a.fingerprint === b.fingerprint && a.settled === b.settled;
}
