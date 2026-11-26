import { Redirect, useLocalSearchParams } from "expo-router";
import { readPublicStoreId, readStoreBrowseScope } from "../../src/features/location/serviceability";
import PublicStoreDetail from "../../src/features/stores/store-detail-screen";

export default function StoreRoute() {
  const { id: value, ...params } = useLocalSearchParams<{
    id?: string | string[]; city?: string | string[]; q?: string | string[]; vertical?: string | string[];
  }>();
  const storeId = readPublicStoreId(value);
  if (storeId === null) {
    const browse = readStoreBrowseScope(params, "");
    return <Redirect href={browse.city ? { pathname: "/stores", params: browse } : "/stores"} />;
  }
  return <PublicStoreDetail storeID={storeId} />;
}
