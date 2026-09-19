export function partnerMutationHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    "X-Correlation-ID": crypto.randomUUID(),
  };
}
