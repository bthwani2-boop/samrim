import { useLocalSearchParams } from "expo-router";

import ClientStoreDetail from "../../src/features/store-discovery/store-detail";
import { ClientPublicShell } from "../../src/shell/client-shell";

export default function ClientStoreRoute() {
  const { storeId: rawStoreId, categoryId: rawCategoryId, productId: rawProductId, promotionId: rawPromotionId } = useLocalSearchParams<{ storeId?: string | string[]; categoryId?: string | string[]; productId?: string | string[]; promotionId?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  const categoryId = Array.isArray(rawCategoryId) ? rawCategoryId[0] ?? "" : rawCategoryId ?? "";
  const productId = Array.isArray(rawProductId) ? rawProductId[0] ?? "" : rawProductId ?? "";
  const promotionId = Array.isArray(rawPromotionId) ? rawPromotionId[0] ?? "" : rawPromotionId ?? "";
  return <ClientPublicShell hideHeader><ClientStoreDetail categoryId={categoryId} productId={productId} promotionId={promotionId} storeId={storeId} /></ClientPublicShell>;
}
