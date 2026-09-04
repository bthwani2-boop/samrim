import { useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../src/navigation/ClientRouteScreen";
export default function CartRoute() {
  const { storeId: rawStoreId } = useLocalSearchParams<{ storeId?: string | string[] }>();
  const storeId = singleRouteParam(rawStoreId);
  return <ClientRouteScreen route={{ kind: "cart", ...(storeId ? { storeId } : {}) }} />;
}
