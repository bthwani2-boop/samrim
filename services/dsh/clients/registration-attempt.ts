export type PendingRegistration = Readonly<{
  fingerprint: string;
  operationId: string;
}>;

const fingerprintPattern = /^[a-f0-9]{64}$/;
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Keep only opaque retry metadata; never persist the submitted business data or bearer. */
export function parsePendingRegistration(raw: string | null): PendingRegistration | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const record = data as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.fingerprint !== "string" ||
      typeof record.operationId !== "string" ||
      !fingerprintPattern.test(record.fingerprint) || !operationIdPattern.test(record.operationId)) {
      return null;
    }
    return { fingerprint: record.fingerprint, operationId: record.operationId };
  } catch {
    return null;
  }
}

export function matchingPendingRegistration(
  pending: PendingRegistration | null, fingerprint: string,
): boolean {
  return pending === null || pending.fingerprint === fingerprint;
}
