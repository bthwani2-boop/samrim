import { useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../../src/navigation/ClientRouteScreen";
export default function AddressesRoute() {
  const { returnStoreId: rawReturnStoreId } = useLocalSearchParams<{ returnStoreId?: string | string[] }>();
  const returnStoreId = singleRouteParam(rawReturnStoreId);
  return <ClientRouteScreen route={{ kind: "profile-addresses", ...(returnStoreId ? { returnStoreId } : {}) }} />;
}
