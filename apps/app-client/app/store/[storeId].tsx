import { useLocalSearchParams } from "expo-router";

import ClientStoreDetail from "../../src/features/store-discovery/store-detail";
import { ClientPublicShell, ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientStoreRoute() {
  const { storeId: rawStoreId, categoryId: rawCategoryId, productId: rawProductId } = useLocalSearchParams<{ storeId?: string | string[]; categoryId?: string | string[]; productId?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  const categoryId = Array.isArray(rawCategoryId) ? rawCategoryId[0] ?? "" : rawCategoryId ?? "";
  const productId = Array.isArray(rawProductId) ? rawProductId[0] ?? "" : rawProductId ?? "";
  return <ClientPublicShell><ClientScrollScreen><ClientStoreDetail categoryId={categoryId} productId={productId} storeId={storeId} /></ClientScrollScreen></ClientPublicShell>;
}
