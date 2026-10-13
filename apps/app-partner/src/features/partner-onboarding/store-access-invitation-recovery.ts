import type { StoreAccessGrant } from "@bthwani/dsh";

export type InvitationAction = "accept" | "decline" | "activate";

// Hash this identity with SHA-256 before passing it as a DSH idempotency key.
// A retry of the same decision on the same version must reuse the same key.
export function invitationActionIdentity(grantID: string, expectedVersion: number, action: InvitationAction): string {
  return `store-access-invitation:${grantID}:${expectedVersion}:${action}`;
}

// DSH is authoritative; a response or a locally changed chip is not confirmation.
// Require the same targeted grant and delegate, an advanced version and an
// appropriate persisted state. Accepted cases can also be immediately active.
export function invitationActionConfirmed(
  original: Pick<StoreAccessGrant, "id" | "storeId" | "delegateActorId" | "version">,
  canonical: StoreAccessGrant | undefined,
  action: InvitationAction,
): boolean {
  if (!canonical || canonical.id !== original.id || canonical.storeId !== original.storeId ||
    canonical.delegateActorId !== original.delegateActorId || canonical.version <= original.version) return false;
  if (action === "decline") return canonical.state === "declined" && Boolean(canonical.declinedAt);
  if (!canonical.acceptedAt) return false;
  if (action === "activate") return canonical.state === "active";
  return canonical.state === "active" || canonical.state === "pending_role_admission" ||
    canonical.state === "pending_partner_activation";
}
