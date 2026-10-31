import type { Metadata } from "expo-router/server";
import type { PublicStoreView } from "@bthwani/dsh";

// A public Store gets indexable metadata only after canonical DSH publication
// and matching Service City readback. Unknown or inaccessible Stores never do.
const unavailable: Metadata = {
  title: "متجر غير متاح | بثواني",
  description: "تصفح المتاجر المتاحة عبر بثواني.",
  robots: { index: false, follow: false },
};

function shareableCover(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    return url.protocol === "https:" ? url.toString() : undefined;
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
  try { cityId = new URL(request.url).searchParams.get("serviceCityId")?.trim() ?? ""; }
  catch { return unavailable; }
  if (!/^[A-Za-z0-9._~-]{1,150}$/.test(cityId)) return unavailable;
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
    if (store.id !== storeId || store.serviceCity?.id !== cityId || !store.name?.trim()) return unavailable;
    const title = `${store.name.trim()} | بثواني`;
    const description = `تصفح منتجات ${store.name.trim()} في ${store.serviceCity.displayNameAr} عبر بثواني.`;
    const image = shareableCover(store.storeCoverImage?.uri);
    return {
      title,
      description,
      openGraph: { title, description, url: request.url, type: "website", ...(image ? { images: image } : {}) },
    };
  } catch { return unavailable; }
}
