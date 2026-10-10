import type { PartnerPayoutRequestCreateRequest, PartnerPayoutRequestView } from "@bthwani/dsh";

function matchingUniqueItems<T>(
  expected: readonly T[],
  actual: readonly T[],
  keyOf: (item: T) => string,
  same: (left: T, right: T) => boolean,
): boolean {
  if (expected.length !== actual.length || expected.length === 0) return false;
  const indexed = new Map<string, T>();
  for (const item of expected) {
    const key = keyOf(item);
    if (!key || indexed.has(key)) return false;
    indexed.set(key, item);
  }
  const seen = new Set<string>();
  for (const item of actual) {
    const key = keyOf(item);
    const original = indexed.get(key);
    if (!original || seen.has(key) || !same(original, item)) return false;
    seen.add(key);
  }
  return seen.size === indexed.size;
}

// Never prove a financial handoff from an ID and aggregate total alone.
// Status may advance independently after the POST, so compare immutable facts.
export function matchesPartnerPayoutReadback(
  requested: PartnerPayoutRequestCreateRequest,
  expected: PartnerPayoutRequestView,
  actual: PartnerPayoutRequestView,
): boolean {
  const requestedStoreIds = requested.storeIds ?? [];
  if (requested.scopeMode !== actual.scopeMode || requestedStoreIds.length === 0 ||
      requestedStoreIds.length !== actual.stores.length ||
      new Set(requestedStoreIds).size !== requestedStoreIds.length ||
      !actual.stores.every((item) => requestedStoreIds.includes(item.storeId))) return false;

  if (requested.scopeMode === "SPECIFIED") {
    const amounts = requested.storeAmounts ?? [];
    const perStore = new Map(amounts.map((item) => [item.storeId, item.amountMinor]));
    if (amounts.length !== requestedStoreIds.length || perStore.size !== amounts.length ||
        !actual.stores.every((item) => perStore.get(item.storeId) === item.amountMinor)) return false;
  }

  if (expected.id !== actual.id || expected.scopeMode !== actual.scopeMode ||
      expected.currency !== actual.currency || expected.totalAmountMinor !== actual.totalAmountMinor ||
      !Number.isSafeInteger(actual.totalAmountMinor) || actual.totalAmountMinor <= 0) return false;

  if (!matchingUniqueItems(expected.stores, actual.stores, (item) => item.storeId,
    (a, b) => a.amountMinor === b.amountMinor && a.currency === b.currency &&
      a.beneficiaryActorId === b.beneficiaryActorId &&
      a.recipientAssignmentVersion === b.recipientAssignmentVersion)) return false;

  // A terminal cancellation or exception is not proof of a payable request.
  if (actual.payouts.some((item) => item.status === "CANCELLED" || item.status === "EXCEPTION")) return false;

  if (!matchingUniqueItems(expected.payouts, actual.payouts, (item) => item.id,
    (a, b) => a.actorType === b.actorType && a.actorId === b.actorId &&
      a.beneficiaryActorId === b.beneficiaryActorId && a.amountMode === b.amountMode &&
      a.resolvedAmountMinor === b.resolvedAmountMinor && a.currency === b.currency &&
      a.destinationId === b.destinationId && a.destinationVersion === b.destinationVersion)) return false;

  return expected.stores.every((item) => Number.isSafeInteger(item.amountMinor) && item.amountMinor > 0) &&
    expected.payouts.every((item) => Number.isSafeInteger(item.resolvedAmountMinor) && item.resolvedAmountMinor > 0) &&
    expected.stores.reduce((total, item) => total + item.amountMinor, 0) === expected.totalAmountMinor &&
    expected.payouts.reduce((total, item) => total + item.resolvedAmountMinor, 0) === expected.totalAmountMinor;
}

/** A recovered GET must prove a payable, internally consistent request before
 * the saved idempotency key can be discarded. Legacy attempts have no saved
 * immutable input snapshot, so verify the canonical financial facts directly. */
export function isRecoverablePartnerPayout(
  recovered: PartnerPayoutRequestView,
  requested?: PartnerPayoutRequestCreateRequest,
): boolean {
  if (recovered.payouts.length === 0 || recovered.stores.length === 0 ||
      !Number.isSafeInteger(recovered.totalAmountMinor) || recovered.totalAmountMinor <= 0 ||
      recovered.payouts.some((item) => item.status === "CANCELLED" || item.status === "EXCEPTION") ||
      !matchingUniqueItems(recovered.stores, recovered.stores, (item) => item.storeId, (a, b) =>
        a.amountMinor === b.amountMinor && a.currency === b.currency &&
        a.beneficiaryActorId === b.beneficiaryActorId &&
        a.recipientAssignmentVersion === b.recipientAssignmentVersion) ||
      !matchingUniqueItems(recovered.payouts, recovered.payouts, (item) => item.id, (a, b) =>
        a.actorId === b.actorId && a.resolvedAmountMinor === b.resolvedAmountMinor) ||
      !recovered.stores.every((item) => Number.isSafeInteger(item.amountMinor) && item.amountMinor > 0 && item.currency === recovered.currency) ||
      !recovered.payouts.every((item) => Number.isSafeInteger(item.resolvedAmountMinor) && item.resolvedAmountMinor > 0 && item.currency === recovered.currency) ||
      recovered.stores.reduce((total, item) => total + item.amountMinor, 0) !== recovered.totalAmountMinor ||
      recovered.payouts.reduce((total, item) => total + item.resolvedAmountMinor, 0) !== recovered.totalAmountMinor) return false;
  return requested ? matchesPartnerPayoutReadback(requested, recovered, recovered) : true;
}
