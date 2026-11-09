import type { CatalogStoreOffer, PartnerAccessibleStore } from "@bthwani/dsh";

export type PartnerStorefrontURL = Readonly<{ url: string; previewOnly: boolean }>;

function safeShareProductId(value: string): boolean {
  return value.length > 0 && value.length <= 150 && !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** A Store URL is public only after DSH publication and an explicit public web origin. */
export function buildPartnerStorefrontURL(
  store: Pick<PartnerAccessibleStore, "id" | "serviceCityId" | "publicationState" | "relationModel">,
  configuredOrigin: string | undefined,
  allowLocalPreview = false,
  productId = "",
): PartnerStorefrontURL | null {
  if (store.publicationState !== "published" || store.relationModel !== "BTHWANI_PARTNER") return null;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(store.id) || !/^[A-Za-z0-9_-]{1,150}$/.test(store.serviceCityId)) return null;
  if (productId && !safeShareProductId(productId)) return null;
  if (!configuredOrigin?.trim()) return null;

  try {
    const url = new URL(configuredOrigin.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const publicHTTPS = url.protocol === "https:" && !loopback;
    const previewOnly = allowLocalPreview && url.protocol === "http:" && loopback;
    if (!publicHTTPS && !previewOnly) return null;
    url.pathname = `/storefront/${encodeURIComponent(store.id)}`;
    url.search = new URLSearchParams({ serviceCityId: store.serviceCityId, ...(productId ? { productId } : {}) }).toString();
    return { url: url.toString(), previewOnly };
  } catch {
    return null;
  }
}

/** Independent public link requires an actual unauthenticated DSH readback in addition to Store publication. */
export function buildPartnerIndependentStorefrontURL(
  store: Pick<PartnerAccessibleStore, "id" | "serviceCityId" | "publicationState" | "relationModel">,
  configuredOrigin: string | undefined,
  publicReadVerified: boolean,
  allowLocalPreview = false,
): PartnerStorefrontURL | null {
  // Independent publication is a separate DSH record. Marketplace publicationState
  // intentionally stays unpublished even when this independent website is live.
  if (!publicReadVerified || store.relationModel !== "INDEPENDENT_STORE") return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(store.id) || !/^[A-Za-z0-9_-]{1,128}$/.test(store.serviceCityId)) return null;
  if (!configuredOrigin?.trim()) return null;
  try {
    const url = new URL(configuredOrigin.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const localDevelopmentSite = allowLocalPreview && url.protocol === "http:" && loopback;
    if (!(url.protocol === "https:" && !loopback) && !localDevelopmentSite) return null;
    url.pathname = "/storefront/" + encodeURIComponent(store.id);
    url.searchParams.set("serviceCityId", store.serviceCityId);
    // Even on localhost this is the unauthenticated public Store route, never
    // the owner draft preview; WhatsApp rejects localhost independently.
    return { url: url.toString(), previewOnly: localDevelopmentSite };
  } catch {
    return null;
  }
}

/** Share only a published, orderable Offer that belongs to the current authorized Store. */
export function buildPartnerOfferShareURL(
  store: Pick<PartnerAccessibleStore, "id" | "serviceCityId" | "publicationState" | "relationModel">,
  offer: Pick<CatalogStoreOffer, "storeId" | "productId" | "publicationState" | "availability" | "productActive" | "variantActive">,
  configuredOrigin: string | undefined,
  allowLocalPreview = false,
): PartnerStorefrontURL | null {
  if (offer.storeId !== store.id || !offer.productId || offer.publicationState !== "published" ||
      !offer.availability || !offer.productActive || !offer.variantActive) return null;
  return buildPartnerStorefrontURL(store, configuredOrigin, allowLocalPreview, offer.productId);
}

/** WhatsApp handoff only for an already published public Store URL, never a local preview. */
export function buildPartnerStoreWhatsAppURL(link: PartnerStorefrontURL | null, storeName: string): string | null {
  if (!link || link.previewOnly) return null;
  try {
    const url = new URL(link.url);
    if (url.protocol !== "https:" || url.username || url.password || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    if (!/^\/storefront\/[A-Za-z0-9_-]{1,150}$/.test(url.pathname)) return null;
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(url.searchParams.get("serviceCityId") ?? "")) return null;
    if (url.hash || url.searchParams.getAll("serviceCityId").length !== 1 || url.searchParams.getAll("productId").length > 1) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "serviceCityId" && key !== "productId")) return null;
    const productId = url.searchParams.get("productId");
    if (productId !== null && !safeShareProductId(productId)) return null;
    const title = storeName.trim().slice(0, 100) || "متجر على بثواني";
    return `https://wa.me/?text=${encodeURIComponent(`${title}\n${url.toString()}`)}`;
  } catch {
    return null;
  }
}
