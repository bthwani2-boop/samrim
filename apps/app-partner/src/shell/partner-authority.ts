import type { PartnerAccessibleStore, StoreAccessPermission } from "@bthwani/dsh";

export type PartnerSurface = "store" | "orders" | "wallet" | "account";

export type PartnerSurfacePath = "/store" | "/orders" | "/wallet" | "/account";

export const PARTNER_SURFACE_ORDER: ReadonlyArray<PartnerSurface> = ["store", "orders", "wallet", "account"];

const PARTNER_SURFACE_PATHS: Record<PartnerSurface, PartnerSurfacePath> = { store: "/store", orders: "/orders", wallet: "/wallet", account: "/account" };

/**
 * Delegated permissions that unlock the Store management surface. Each entry
 * must correspond to a material function that actually renders inside the
 * Store surface today: catalog (StoreOfferManagement), store_operations
 * (StoreOperationalAvailabilityManagement), promotions (StorePromotionsCard).
 * `fulfillment` is deliberately absent: its actions live inside Orders
 * surfaces and are reachable through the `orders` grant, so it must not widen
 * Store visibility until a material fulfillment function exists inside Store.
 */
const STORE_SURFACE_PERMISSIONS: ReadonlyArray<StoreAccessPermission> = ["catalog", "store_operations", "promotions"];

/**
 * Delegated permissions that unlock the Wallet surface. Store-level guards
 * inside the Wallet surface still decide what renders (finance_read readback,
 * payout_request actions), so the surface only states that the actor holds a
 * material wallet function on at least one granted store.
 */
const WALLET_SURFACE_PERMISSIONS: ReadonlyArray<StoreAccessPermission> = ["finance_read", "payout_request"];

export type PartnerAuthority = Readonly<{
  owner: boolean;
  surfaces: ReadonlyArray<PartnerSurface>;
  canUse: (surface: PartnerSurface) => boolean;
}>;

/**
 * While accessible stores cannot be proven (loading or read failure) the only
 * provable surface is the actor's own Account. Surfaces are never shown on
 * unprovable authority, and direct access fails safely through the gate.
 */
export const RESOLVING_PARTNER_AUTHORITY: PartnerAuthority = {
  owner: false,
  surfaces: ["account"],
  canUse: (surface) => surface === "account",
};

export function derivePartnerAuthority(stores: ReadonlyArray<PartnerAccessibleStore>): PartnerAuthority {
  const owner = stores.some((store) => store.owned);
  const grantsPermission = (permission: StoreAccessPermission) => stores.some((store) => store.permissions.includes(permission));
  // With no accessible store at all, the Store surface keeps rendering its
  // identity-scoped empty state (access invitations, joining-case entry); it
  // exposes no store authority, so it cannot lead to an unauthorized space.
  const canUseStore = owner || stores.length === 0 || STORE_SURFACE_PERMISSIONS.some(grantsPermission);
  const canUseOrders = owner || grantsPermission("orders");
  const canUseWallet = owner || WALLET_SURFACE_PERMISSIONS.some(grantsPermission);
  const surfaces = PARTNER_SURFACE_ORDER.filter((surface) => surface === "account" || (surface === "store" ? canUseStore : surface === "orders" ? canUseOrders : canUseWallet));
  return { owner, surfaces, canUse: (surface) => surfaces.includes(surface) };
}

export function partnerSurfacePath(surface: PartnerSurface): PartnerSurfacePath {
  return PARTNER_SURFACE_PATHS[surface];
}

/**
 * Canonical landing surface for an actor: the first surface the actor can
 * actually use, in the stable navigation order. Unauthorized deep links and
 * identity-gate defaults redirect here instead of relying on hidden tabs.
 */
export function canonicalPartnerSurfacePath(authority: PartnerAuthority): PartnerSurfacePath {
  return PARTNER_SURFACE_PATHS[authority.surfaces[0] ?? "account"];
}
