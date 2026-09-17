import { useLocalSearchParams } from "expo-router";

import ServiceCityScope from "../../src/features/service-city/service-city-scope";
import ClientStoreDetail from "../../src/features/store-discovery/store-detail";
import { ClientPublicShell, ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientStoreRoute() {
  const { storeId: rawStoreId } = useLocalSearchParams<{ storeId?: string | string[] }>();
  const storeId = Array.isArray(rawStoreId) ? rawStoreId[0] ?? "" : rawStoreId ?? "";
  return <ServiceCityScope><ClientPublicShell><ClientScrollScreen><ClientStoreDetail storeId={storeId} /></ClientScrollScreen></ClientPublicShell></ServiceCityScope>;
}
