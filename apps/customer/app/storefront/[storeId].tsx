import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import type { GenerateMetadataFunction } from "expo-router/server";
import { Platform } from "react-native";
import PublicStoreDetail from "../../src/features/stores/store-detail-screen";

// Public listing does not authorize search indexing of Store sites before release approval.
export const generateMetadata: GenerateMetadataFunction = () => ({
  title: "موقع المتجر | بثواني",
  description: "استعرض معلومات المتجر والعروض المنشورة في بثواني.",
  robots: { index: false, follow: false },
});

export default function FullStorefrontRoute() {
  const { storeId: value } = useLocalSearchParams<{ storeId?: string | string[] }>();
  const storeId = typeof value === "string" ? value : "";
  if (Platform.OS !== "web") {
    return <Redirect href={(`/store/${encodeURIComponent(storeId)}`) as Href} />;
  }
  // Same public DSH Store/Offer owner as the marketplace, with a wider Web presentation.
  // Never infer checkout eligibility from publication.
  return <PublicStoreDetail storeID={storeId} fullPage />;
}
