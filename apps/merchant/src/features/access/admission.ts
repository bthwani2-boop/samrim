import {
  admitCurrentCustomerAsMerchant,
  IdentityClientError,
  readVerifiedIdentitySession,
  resumeCurrentCustomerMerchantSession,
  revokeVerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";

export async function verifyMerchantAdmission(
  origin: string, ticket: string, code: string, signal?: AbortSignal,
) {
  const customer = await verifyCustomerPhoneChallenge(origin, ticket, code, signal);
  try {
    const source = await readVerifiedIdentitySession(origin, customer.accessToken, signal);
    if (source.role !== "customer") throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    const issued = await admitCurrentCustomerAsMerchant(origin, customer.accessToken, signal)
      .catch((error: unknown) => {
        if (error instanceof IdentityClientError &&
            (error.code === "ALREADY_PROVISIONED" || error.code === "OPERATION_RESULT_UNKNOWN") &&
            !signal?.aborted) {
          return resumeCurrentCustomerMerchantSession(origin, customer.accessToken, signal);
        }
        throw error;
      });
    const session = await readVerifiedIdentitySession(origin, issued.accessToken, signal);
    if (session.role !== "merchant" || session.actorId !== source.actorId) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    return { bearer: issued.accessToken, session };
  } finally {
    // The temporary Customer credential is never persisted by Merchant.
    const cleanup = new AbortController();
    const timeout = setTimeout(() => cleanup.abort(), 2000);
    try {
      await revokeVerifiedIdentitySession(origin, customer.accessToken, cleanup.signal)
        .catch(() => undefined);
    } finally {
      clearTimeout(timeout);
    }
  }
}
