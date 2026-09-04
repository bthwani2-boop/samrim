import { Redirect, useLocalSearchParams } from "expo-router";
import { ClientRouteScreen, singleRouteParam } from "../../../src/navigation/ClientRouteScreen";
export default function OrderChatRoute() {
  const params = useLocalSearchParams<{ orderId?: string | string[]; fulfillmentMode?: string | string[] }>();
  const orderId = singleRouteParam(params.orderId);
  const mode = singleRouteParam(params.fulfillmentMode);
  if (!orderId) return <Redirect href="/orders" />;
  const fulfillmentMode = mode === "bthwani_delivery" || mode === "partner_delivery" || mode === "pickup" ? mode : undefined;
  return <ClientRouteScreen route={{ kind: "order-chat", orderId, ...(fulfillmentMode ? { fulfillmentMode } : {}) }} />;
}
