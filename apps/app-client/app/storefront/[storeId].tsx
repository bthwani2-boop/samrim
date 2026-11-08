import { Redirect, type Href, useLocalSearchParams } from "expo-router";
import type { GenerateMetadataFunction } from "expo-router/server";
import { Platform } from "react-native";

import ClientFullStorefront from "../../src/features/store-discovery/full-storefront";
import { ClientPublicShell } from "../../src/shell/client-shell";

// This bounded read-only route is not an independent public Store release.
// Keep search indexing disabled until the canonical DSH website-publication
// contract and public URL policy are approved.
export const generateMetadata: GenerateMetadataFunction = () => ({
  title: "موقع المتجر | بثواني",
  description: "تصفح منتجات المتاجر الشريكة المنشورة في بثواني.",
  robots: { index: false, follow: false },
});

export default function FullStorefrontRoute() {
  const { storeId: rawStoreID, serviceCityId: rawCityID } = useLocalSearchParams<{
    storeId?: string | string[];
    serviceCityId?: string | string[];
  }>();
  const storeId = Array.isArray(rawStoreID) ? rawStoreID[0] ?? "" : rawStoreID ?? "";
  const cityID = Array.isArray(rawCityID) ? rawCityID[0] ?? "" : rawCityID ?? "";

  if (Platform.OS !== "web") {
    const path = "/store/" + encodeURIComponent(storeId) +
      (cityID ? "?serviceCityId=" + encodeURIComponent(cityID) : "");
    return <Redirect href={path as Href} />;
  }
  return <ClientPublicShell hideHeader><ClientFullStorefront storeId={storeId} /></ClientPublicShell>;
}
