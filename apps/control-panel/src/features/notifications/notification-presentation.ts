import type { NotificationKind } from "@bthwani/dsh";

export function notificationKindLabel(kind: NotificationKind) {
  if (kind.startsWith("FIELD_")) return "شريك";
  if (kind.startsWith("CAPTAIN_") || ["HANDOFF_CONFIRMED", "PICKED_UP", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_RECOVERED", "REASSIGNED"].includes(kind)) return "توصيل";
  return "طلب";
}
