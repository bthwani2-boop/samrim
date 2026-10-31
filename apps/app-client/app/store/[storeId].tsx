import { useLocalSearchParams } from "expo-router";
import type { GenerateMetadataFunction } from "expo-router/server";

import ClientStoreDetail from "../../src/features/store-discovery/store-detail";
import { ClientPublicShell } from "../../src/shell/client-shell";
import { readPublicStoreMetadata } from "../../src/features/store-discovery/public-store-metadata";

export const generateMetadata: GenerateMetadataFunction = (request, params) =>
  readPublicStoreMetadata(request ?? undefined, String(params.storeId ?? ""), process.env.EXPO_PUBLIC_DSH_API_URL);

export default function ClientStoreRoute() {
  const { storeId: rawStoreId, categoryId: rawCategoryId, productId: rawProductId, promotionId: rawPromotionId } = useLocalSearchParams<{ storeId?: string | string[]; categoryId?: string | string[]; productId?: string | string[]; promotionId?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  const categoryId = Array.isArray(rawCategoryId) ? rawCategoryId[0] ?? "" : rawCategoryId ?? "";
  const productId = Array.isArray(rawProductId) ? rawProductId[0] ?? "" : rawProductId ?? "";
  const promotionId = Array.isArray(rawPromotionId) ? rawPromotionId[0] ?? "" : rawPromotionId ?? "";
  return <ClientPublicShell hideHeader><ClientStoreDetail categoryId={categoryId} productId={productId} promotionId={promotionId} storeId={storeId} /></ClientPublicShell>;
}
