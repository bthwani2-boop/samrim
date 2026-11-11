import type { StoreCaptainMembership } from "@bthwani/dsh";

export function visibleCaptainStoreMemberships<T extends Pick<StoreCaptainMembership, "state">>(
  memberships: readonly T[],
): T[] {
  return memberships.filter((item) => item.state === "active" || item.state === "pending");
}

export function preferredCaptainProfileMembership<
  T extends Pick<StoreCaptainMembership, "state" | "displayNameAr">,
>(memberships: readonly T[]): T | undefined {
  const visible = visibleCaptainStoreMemberships(memberships);
  // DSH's accepted membership state is authoritative; a Store-provided display
  // label must not demote a valid Captain to a pending or absent profile.
  return visible.find((item) => item.state === "active")
    ?? visible.find((item) => Boolean(item.displayNameAr?.trim()));
}
