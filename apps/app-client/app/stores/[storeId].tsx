import { Redirect, useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../../src/navigation/ClientRouteScreen";
export default function StoreRoute() {
  const { storeId: rawStoreId } = useLocalSearchParams<{ storeId?: string | string[] }>();
  const storeId = singleRouteParam(rawStoreId);
  if (!storeId) return <Redirect href="/stores" />;
  return <ClientRouteScreen route={{ kind: "store", storeId }} />;
}
