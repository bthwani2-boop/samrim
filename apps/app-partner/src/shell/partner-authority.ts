import type { PartnerAccessibleStore, StoreAccessPermission } from "@bthwani/dsh";

export type PartnerSurface = "orders" | "products" | "wallet" | "more" | "store" | "employees" | "account";
export type PartnerSurfacePath = "/orders" | "/products" | "/wallet" | "/more" | "/store" | "/employees" | "/account";

const PARTNER_SURFACE_PATHS: Record<PartnerSurface, PartnerSurfacePath> = {
  orders: "/orders", products: "/products", wallet: "/wallet",
  more: "/more", store: "/store", employees: "/employees", account: "/account",
};

const STORE_SURFACE_PERMISSIONS: ReadonlyArray<StoreAccessPermission> = ["store_operations", "promotions"];
const WALLET_SURFACE_PERMISSIONS: ReadonlyArray<StoreAccessPermission> = ["finance_read", "payout_request"];

/** Independent Store catalog rights never grant marketplace order or money surfaces. */
export function isMarketplaceStore(store: Pick<PartnerAccessibleStore, "relationModel">): boolean {
  return store.relationModel === "BTHWANI_PARTNER";
}

export type PartnerAuthority = Readonly<{
  owner: boolean;
  surfaces: ReadonlyArray<PartnerSurface>;
  canUse: (surface: PartnerSurface) => boolean;
}>;

export const RESOLVING_PARTNER_AUTHORITY: PartnerAuthority = {
  owner: false,
  surfaces: ["more", "account"],
  canUse: (surface) => surface === "more" || surface === "account",
};

export function derivePartnerAuthority(stores: ReadonlyArray<PartnerAccessibleStore>): PartnerAuthority {
  const owner = stores.some((store) => store.owned);
  const grants = (permission: StoreAccessPermission) => stores.some((store) => store.permissions.includes(permission));
  const marketplaceGrants = (permission: StoreAccessPermission) => stores.some((store) => isMarketplaceStore(store) && store.permissions.includes(permission));
  const marketplaceOwner = stores.some((store) => isMarketplaceStore(store) && store.owned);
  const canUseStore = owner || stores.length === 0 || STORE_SURFACE_PERMISSIONS.some(grants);
  const canUseOrders = marketplaceOwner || marketplaceGrants("orders");
  const canUseProducts = owner || grants("catalog");
  const canUseWallet = marketplaceOwner || WALLET_SURFACE_PERMISSIONS.some(marketplaceGrants);
  const surfaces = [
    ...(canUseOrders ? ["orders" as const] : []),
    ...(canUseProducts ? ["products" as const] : []),
    ...(canUseWallet ? ["wallet" as const] : []),
    "more" as const,
    ...(canUseStore ? ["store" as const] : []),
    ...(owner ? ["employees" as const] : []),
    "account" as const,
  ];
  return { owner, surfaces, canUse: (surface) => surfaces.includes(surface) };
}

export function canonicalPartnerSurfacePath(authority: PartnerAuthority): PartnerSurfacePath {
  return PARTNER_SURFACE_PATHS[authority.surfaces[0] ?? "more"];
}
