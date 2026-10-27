import type { Order } from "@bthwani/dsh";

export type OrderFulfillmentFilter = "all" | "bthwani" | "store" | "pickup";
export type OrderStatusFilter = "all" | "active" | "completed" | "cancelled";

export function isPartialOrderListEmpty(visibleOrderCount: number, nextCursor: string): boolean {
  return visibleOrderCount === 0 && nextCursor.trim().length > 0;
}

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
  if (fulfillment === "pickup") return order.fulfillmentMode === "CUSTOMER_PICKUP";
  if (fulfillment === "store") return order.fulfillmentMode === "PARTNER_CAPTAIN";
  return order.fulfillmentMode === "BTHWANI_CAPTAIN";
}
