import { Redirect, useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../../../src/navigation/ClientRouteScreen";
export default function OrderPickupRoute() {
  const { orderId: rawOrderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = singleRouteParam(rawOrderId);
  if (!orderId) return <Redirect href="/orders" />;
  return <ClientRouteScreen route={{ kind: "order-pickup", orderId }} />;
}
