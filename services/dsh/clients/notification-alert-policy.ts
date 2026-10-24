import type { Notification } from "./generated/dsh-types";

export type AlertRole = "client" | "partner" | "captain" | "operator";
export type OrderAlertLevel = "action" | "silent";

export function orderAlertLevel(role: AlertRole, item: Pick<Notification, "kind" | "title">): OrderAlertLevel {
  if (role === "partner" && item.kind === "ORDER_CREATED") return "action";
  // The same CAPTAIN_OFFER kind represents expiration/rejection. Only an actual
  // new offer must ring; never wake a captain for an expired or rejected offer.
  if (role === "captain" && item.kind === "CAPTAIN_OFFER" && item.title === "طلب توصيل جديد") return "action";
  // There is not yet a canonical drop-off-arrival event. Do not infer arrival
  // from pickup or assignment; that would falsely wake the customer.
  if (role === "client" && item.kind === "CAPTAIN_ARRIVED") return "action";
  if (role === "client") return "silent";
  if (role === "operator" && item.kind === "DELIVERY_FAILED") return "action";
  return "silent";
}

/** Tracks server IDs per authenticated actor. Baseline never rings for old history. */
export class OrderAlertCursor {
  private actor = "";
  private primed = false;
  private seen = new Set<string>();

  reset(actor: string): void {
    if (this.actor === actor) return;
    this.actor = actor;
    this.primed = false;
    this.seen.clear();
  }

  receive(role: AlertRole, actor: string, items: ReadonlyArray<Notification>, now = Date.now()): Notification[] {
    this.reset(actor);
    if (!actor) return [];
    const fresh: Notification[] = [];
    for (const item of items) {
      if (this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      const age = now - Date.parse(item.createdAt);
      const resolvedBy = role === "captain" && item.kind === "CAPTAIN_OFFER"
        ? new Set(["CAPTAIN_OFFER", "CAPTAIN_ASSIGNED", "REASSIGNED", "PICKED_UP", "DELIVERED"])
        : role === "partner" && item.kind === "ORDER_CREATED"
          ? new Set(["ORDER_ACCEPTED", "ORDER_PREPARING", "ORDER_READY", "ORDER_REJECTED", "DELIVERED", "ORDER_STATUS"])
          : role === "operator" && item.kind === "DELIVERY_FAILED"
            ? new Set(["DELIVERY_RECOVERED", "DELIVERED"])
            : new Set<string>();
      const superseded = Boolean(item.orderId) && items.some(
        next => next.id !== item.id && next.orderId === item.orderId
          && resolvedBy.has(next.kind)
          && Date.parse(next.createdAt) > Date.parse(item.createdAt),
      );
      if (this.primed && !item.readAt && !superseded
        && Number.isFinite(age) && age >= 0 && age < 90_000 && orderAlertLevel(role, item) === "action") {
        fresh.push(item);
      }
    }
    // No duplicate ringing after re-fetch, and cap memory when the inbox rolls.
    if (this.seen.size > 300) this.seen = new Set(items.map((item) => item.id));
    this.primed = true;
    return fresh.reverse();
  }
}
