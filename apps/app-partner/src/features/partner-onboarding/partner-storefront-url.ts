import type { PartnerAccessibleStore } from "@bthwani/dsh";

export type PartnerStorefrontURL = Readonly<{ url: string; previewOnly: boolean }>;

/** A Store URL is public only after DSH publication and an explicit public web origin. */
export function buildPartnerStorefrontURL(
  store: Pick<PartnerAccessibleStore, "id" | "serviceCityId" | "publicationState">,
  configuredOrigin: string | undefined,
  allowLocalPreview = false,
): PartnerStorefrontURL | null {
  if (store.publicationState !== "published") return null;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(store.id) || !/^[A-Za-z0-9_-]{1,150}$/.test(store.serviceCityId)) return null;
  if (!configuredOrigin?.trim()) return null;

  try {
    const url = new URL(configuredOrigin.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const publicHTTPS = url.protocol === "https:" && !loopback;
    const previewOnly = allowLocalPreview && url.protocol === "http:" && loopback;
    if (!publicHTTPS && !previewOnly) return null;
    url.pathname = `/store/${encodeURIComponent(store.id)}`;
    url.search = new URLSearchParams({ serviceCityId: store.serviceCityId }).toString();
    return { url: url.toString(), previewOnly };
  } catch {
    return null;
  }
}

/** WhatsApp handoff only for an already published public Store URL, never a local preview. */
export function buildPartnerStoreWhatsAppURL(link: PartnerStorefrontURL | null, storeName: string): string | null {
  if (!link || link.previewOnly) return null;
  try {
    const url = new URL(link.url);
    if (url.protocol !== "https:" || url.username || url.password || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    if (!/^\/store\/[A-Za-z0-9_-]{1,150}$/.test(url.pathname) || !url.searchParams.get("serviceCityId")) return null;
    const title = storeName.trim().slice(0, 100) || "متجر على بثواني";
    return `https://wa.me/?text=${encodeURIComponent(`${title}\n${url.toString()}`)}`;
  } catch {
    return null;
  }
}
