import type { StoreAccessGrant, StoreAccessPermission } from "@bthwani/dsh";

// A successful HTTP mutation is not proof of a persisted invitation.
// Confirm the exact DSH owner grant; the delegate may have accepted meanwhile.
export function storeInvitationReadbackConfirmed(
  targetStoreID: string,
  submitted: StoreAccessGrant,
  requestedPermissions: ReadonlyArray<StoreAccessPermission>,
  canonical: StoreAccessGrant | undefined,
): boolean {
  if (!canonical || !submitted.id || submitted.storeId !== targetStoreID ||
    canonical.id !== submitted.id || canonical.storeId !== targetStoreID ||
    !submitted.ownerPartnerActorId || canonical.ownerPartnerActorId !== submitted.ownerPartnerActorId ||
    !submitted.delegateActorId || canonical.delegateActorId !== submitted.delegateActorId ||
    canonical.version < submitted.version) return false;

  if (!["pending_acceptance", "pending_role_admission", "pending_partner_activation", "active"].includes(canonical.state)) return false;
  const expected = [...requestedPermissions].sort((a, b) => a.localeCompare(b)).join("|");
  return expected.length > 0 &&
    [...submitted.permissions].sort((a, b) => a.localeCompare(b)).join("|") === expected &&
    [...canonical.permissions].sort((a, b) => a.localeCompare(b)).join("|") === expected;
}
