import type { Order } from "@bthwani/dsh";

export type OrderFulfillmentFilter = "all" | "delivery" | "pickup";

export function matchesOrderFilters(order: Pick<Order, "fulfillmentMode">, fulfillment: OrderFulfillmentFilter): boolean {
  if (fulfillment === "all") return true;
  const pickup = order.fulfillmentMode === "CUSTOMER_PICKUP";
  return fulfillment === "pickup" ? pickup : !pickup;
}
