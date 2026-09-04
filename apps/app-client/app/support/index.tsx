import { useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../../src/navigation/ClientRouteScreen";
export default function SupportRoute() {
  const { orderId: rawOrderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = singleRouteParam(rawOrderId);
  return <ClientRouteScreen route={{ kind: "support", ...(orderId ? { orderId } : {}) }} />;
}
