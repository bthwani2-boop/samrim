import {
  admitCurrentCustomerAsMerchant,
  IdentityClientError,
  readVerifiedIdentitySession,
  resumeCurrentCustomerMerchantSession,
  revokeVerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";

export async function revokeUndeliveredAdmissionSession(origin: string, bearer: string) {
  const cleanup = new AbortController();
  const timeout = setTimeout(() => cleanup.abort(), 2000);
  try {
    await revokeVerifiedIdentitySession(origin, bearer, cleanup.signal).catch(() => undefined);
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyMerchantAdmission(
  origin: string, ticket: string, code: string, signal?: AbortSignal,
) {
  const customer = await verifyCustomerPhoneChallenge(origin, ticket, code, signal);
  let merchantBearer: string | undefined;
  let session: Awaited<ReturnType<typeof readVerifiedIdentitySession>>;
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
    merchantBearer = issued.accessToken;
    session = await readVerifiedIdentitySession(origin, merchantBearer, signal);
    if (session.role !== "merchant" || session.actorId !== source.actorId) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
  } catch (error) {
    if (merchantBearer !== undefined) await revokeUndeliveredAdmissionSession(origin, merchantBearer);
    throw error;
  } finally {
    // The temporary Customer credential is never persisted by Merchant.
    await revokeUndeliveredAdmissionSession(origin, customer.accessToken);
  }
  if (signal?.aborted) {
    await revokeUndeliveredAdmissionSession(origin, merchantBearer);
    throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
  }
  return { bearer: merchantBearer, session };
}
