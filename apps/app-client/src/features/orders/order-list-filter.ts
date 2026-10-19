import type { Order } from "@bthwani/dsh";

export type OrderFulfillmentFilter = "all" | "delivery" | "pickup";
export type OrderStatusFilter = "all" | "active" | "completed" | "stopped";

export function matchesOrderFilters(
  order: Pick<Order, "state" | "fulfillmentMode">,
  fulfillment: OrderFulfillmentFilter,
  status: OrderStatusFilter,
): boolean {
  const pickup = order.fulfillmentMode === "CUSTOMER_PICKUP";
  if (fulfillment === "pickup" && !pickup) return false;
  if (fulfillment === "delivery" && pickup) return false;

  if (status === "all") return true;
  const completed = order.state === "DELIVERED" || order.state === "PICKED_UP";
  const stopped = order.state === "CANCELLED" || order.state === "REJECTED" || order.state === "DELIVERY_FAILED";
  if (status === "completed") return completed;
  if (status === "stopped") return stopped;
  return !completed && !stopped;
}
