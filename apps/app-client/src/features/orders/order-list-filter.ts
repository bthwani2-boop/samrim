import type { Order } from "@bthwani/dsh";

export type OrderFulfillmentFilter = "all" | "delivery" | "pickup";
export type OrderStatusFilter = "all" | "active" | "completed" | "cancelled";

export function matchesOrderStatus(state: Order["state"], filter: OrderStatusFilter): boolean {
  if (filter === "all") return true;
  const cancelled = state === "CANCELLED" || state === "REJECTED" || state === "DELIVERY_FAILED";
  const completed = state === "DELIVERED" || state === "PICKED_UP";
  if (filter === "cancelled") return cancelled;
  if (filter === "completed") return completed;
  return !cancelled && !completed;
}


export function matchesOrderFilters(order: Pick<Order, "fulfillmentMode">, fulfillment: OrderFulfillmentFilter): boolean {
  if (fulfillment === "all") return true;
  const pickup = order.fulfillmentMode === "CUSTOMER_PICKUP";
  return fulfillment === "pickup" ? pickup : !pickup;
}
