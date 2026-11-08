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
  const { storeId: rawStoreID, serviceCityId: rawCityID, categoryId, productId, q } = useLocalSearchParams<{
    storeId?: string | string[];
    serviceCityId?: string | string[];
    categoryId?: string | string[];
    productId?: string | string[];
    q?: string | string[];
  }>();
  const storeId = Array.isArray(rawStoreID) ? rawStoreID[0] ?? "" : rawStoreID ?? "";
  const cityID = Array.isArray(rawCityID) ? rawCityID[0] ?? "" : rawCityID ?? "";
  const productID = typeof productId === "string" ? productId.trim() : "";
  const categoryID = !productID && typeof categoryId === "string" ? categoryId.trim() : "";
  const query = !productID && typeof q === "string" ? q.trim() : "";

  if (Platform.OS !== "web") {
    const params = new URLSearchParams();
    if (cityID) params.set("serviceCityId", cityID);
    if (categoryID) params.set("categoryId", categoryID);
    if (productID) params.set("productId", productID);
    const path = "/store/" + encodeURIComponent(storeId) + (params.size ? "?" + params : "");
    return <Redirect href={path as Href} />;
  }
  return <ClientPublicShell hideHeader>
    <ClientFullStorefront
      storeId={storeId}
      key={JSON.stringify([storeId, cityID, categoryID, productID, query])}
      linkedCityID={cityID}
      categoryID={categoryID}
      productID={productID}
      initialQuery={query}
    />
  </ClientPublicShell>;
}
