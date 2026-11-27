import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";

type ProofDenial = {
  kind: "denied";
  stage: "before" | "after";
  status: 401 | 403 | 503;
  reason: "identity" | "role" | "actor" | "expired" | "unavailable";
};
type OwnerOutcome<T> = { kind: "accepted"; value: T } | { kind: "rejected"; error: unknown };
type Result<T> = ProofDenial | OwnerOutcome<T>;

function denied(stage: ProofDenial["stage"], status: ProofDenial["status"],
  reason: ProofDenial["reason"]): ProofDenial {
  return { kind: "denied", stage, status, reason };
}

function identityFailure(stage: ProofDenial["stage"], error: unknown): ProofDenial {
  if (error instanceof IdentityClientError && (error.status === 401 || error.status === 403)) {
    return denied(stage, stage === "after" ? 401 : error.status, "identity");
  }
  return denied(stage, 503, "unavailable");
}

/** Cookie adapters admit one DSH outcome only within the same original Identity proof.
 *  No credential refresh, persistence, retry, or business authority is delegated here.
 */
export async function withCustomerOwnerSession<T>(
  identityOrigin: string, bearer: string, expectedActor: string | null,
  signal: AbortSignal, run: (actor: string) => Promise<T>,
): Promise<Result<T>> {
  let before: Awaited<ReturnType<typeof readVerifiedIdentitySession>>;
  try {
    signal.throwIfAborted();
    before = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    signal.throwIfAborted();
  } catch (error) {
    return identityFailure("before", error);
  }
  if (before.role !== "customer") return denied("before", 403, "role");
  if (expectedActor !== null && expectedActor !== before.actorId) return denied("before", 403, "actor");
  const expiry = Date.parse(before.sessionExpiresAt);
  if (!(expiry > Date.now())) return denied("before", 401, "expired");

  let outcome: OwnerOutcome<T>;
  try {
    outcome = { kind: "accepted", value: await run(before.actorId) };
  } catch (error) {
    outcome = { kind: "rejected", error };
  }
  try {
    signal.throwIfAborted();
    const after = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    signal.throwIfAborted();
    if (after.role !== "customer") return denied("after", 401, "role");
    if (after.actorId !== before.actorId) return denied("after", 401, "actor");
    if (!(Math.min(expiry, Date.parse(after.sessionExpiresAt)) > Date.now())) {
      return denied("after", 401, "expired");
    }
    return outcome;
  } catch (error) {
    return identityFailure("after", error);
  }
}
