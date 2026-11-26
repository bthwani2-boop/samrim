import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import type { GenerateMetadataFunction } from "expo-router/server";
import { Platform } from "react-native";
import { readPublicStoreId, readStoreBrowseScope } from "../../src/features/location/serviceability";
import StorefrontScreen from "../../src/features/stores/storefront-screen";

// Public listing does not authorize search indexing of Store sites before release approval.
export const generateMetadata: GenerateMetadataFunction = () => ({
  title: "موقع المتجر | بثواني",
  description: "استعرض معلومات المتجر والعروض المنشورة في بثواني.",
  robots: { index: false, follow: false },
});

export default function FullStorefrontRoute() {
  const { storeId: value, ...params } = useLocalSearchParams<{
    storeId?: string | string[]; city?: string | string[]; q?: string | string[]; vertical?: string | string[];
  }>();
  const storeId = readPublicStoreId(value);
  const browse = readStoreBrowseScope(params, "");
  if (storeId === null) {
    return <Redirect href={browse.city ? { pathname: "/stores", params: browse } : "/stores"} />;
  }
  if (Platform.OS !== "web") {
    const pathname = `/store/${storeId}`;
    return <Redirect href={(browse.city ? { pathname, params: browse } : pathname) as Href} />;
  }
  // Same public DSH Store/Offer owner as the marketplace, with a wider Web presentation.
  // Never infer checkout eligibility from publication.
  return <StorefrontScreen storeId={storeId} />;
}
