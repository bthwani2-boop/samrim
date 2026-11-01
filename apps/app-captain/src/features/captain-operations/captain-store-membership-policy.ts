import type { StoreCaptainMembership } from "@bthwani/dsh";

export function visibleCaptainStoreMemberships<T extends Pick<StoreCaptainMembership, "state">>(
  memberships: readonly T[],
): T[] {
  return memberships.filter((item) => item.state === "active" || item.state === "pending");
}

export function preferredCaptainProfileMembership<
  T extends Pick<StoreCaptainMembership, "state" | "displayNameAr">,
>(memberships: readonly T[]): T | undefined {
  const visible = visibleCaptainStoreMemberships(memberships).filter((item) => Boolean(item.displayNameAr?.trim()));
  return visible.find((item) => item.state === "active") ?? visible[0];
}
