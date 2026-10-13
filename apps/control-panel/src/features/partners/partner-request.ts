export function partnerMutationHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    "X-Correlation-ID": crypto.randomUUID(),
  };
}

export async function stablePartnerMutationHeaders(scope: string): Promise<HeadersInit> {
  const normalized = scope.trim();
  if (!normalized) throw new Error("A stable Partner mutation scope is required.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const token = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": `partner_${token}`,
    "X-Correlation-ID": `partner_corr_${token}`,
  };
}
