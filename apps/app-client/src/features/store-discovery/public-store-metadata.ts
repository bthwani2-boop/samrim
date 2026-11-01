import type { Metadata } from "expo-router/server";
import type { PublicStoreView } from "@bthwani/dsh";

// A public Store gets indexable metadata only after canonical DSH publication
// and matching Service City readback. Unknown or inaccessible Stores never do.
const unavailable: Metadata = {
  title: "متجر غير متاح | بثواني",
  description: "تصفح المتاجر المتاحة عبر بثواني.",
  robots: { index: false, follow: false },
};

// Local previews must remain non-indexable without misleading users about live Store readiness.
const localPreview: Metadata = {
  title: "معاينة المتجر | بثواني",
  description: "معاينة محلية لمتجر بثواني.",
  robots: { index: false, follow: false },
};

function configuredPublicOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const origin = new URL(value.trim());
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.protocol !== "https:" || loopback || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return undefined;
    return origin.origin;
  } catch { return undefined; }
}

function shareableCover(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const localHost = hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal");
    const addressLiteral = hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname) || /^\d+$/.test(hostname);
    return url.protocol === "https:" && !url.username && !url.password && !localHost && !addressLiteral
      ? url.toString()
      : undefined;
  } catch { return undefined; }
}

export async function readPublicStoreMetadata(
  request: Readonly<{ url: string }> | undefined,
  storeId: string,
  apiURL: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Metadata> {
  if (!request || !apiURL || !/^[A-Za-z0-9._~-]{1,150}$/.test(storeId)) return unavailable;
  let cityId = "";
  try {
    const incoming = new URL(request.url);
    if (["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname)) return localPreview;
    if (incoming.protocol !== "https:") return unavailable;
    cityId = incoming.searchParams.get("serviceCityId")?.trim() ?? "";
  } catch { return unavailable; }
  if (!/^[A-Za-z0-9._~-]{1,150}$/.test(cityId)) return unavailable;
  // Never derive canonical metadata from the request Host, which may be an untrusted alias.
  const publicOrigin = configuredPublicOrigin(process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN);
  if (!publicOrigin) return unavailable;
  try {
    const base = new URL(apiURL);
    if (!["http:", "https:"].includes(base.protocol)) return unavailable;
    const path = `/dsh/public/stores/${encodeURIComponent(storeId)}?serviceCityId=${encodeURIComponent(cityId)}`;
    const response = await fetcher(new URL(path, base).toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return unavailable;
    const store = await response.json() as PublicStoreView;
    if (store.id !== storeId || store.serviceCity?.id !== cityId || store.serviceCity.active !== true ||
      !store.serviceCity.displayNameAr?.trim() || !store.name?.trim()) return unavailable;
    const title = `${store.name.trim()} | بثواني`;
    const description = `تصفح منتجات ${store.name.trim()} في ${store.serviceCity.displayNameAr} عبر بثواني.`;
    const image = shareableCover(store.storeCoverImage?.uri);
    // A stable canonical URL keeps the Service City, but drops tracking and deep-link parameters.
    const canonicalURL = `${publicOrigin}/store/${encodeURIComponent(storeId)}?serviceCityId=${encodeURIComponent(cityId)}`;
    return {
      title,
      description,
      robots: { index: true, follow: true },
      alternates: { canonical: canonicalURL },
      openGraph: { title, description, url: canonicalURL, type: "website", ...(image ? { images: image } : {}) },
      twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: image } : {}) },
    };
  } catch { return unavailable; }
}
