import type { Notification, NotificationKind } from "@bthwani/dsh";

export function notificationKindLabel(kind: NotificationKind) {
  if (kind === "STORE_AVAILABILITY_CHANGED") return "تشغيل";
  if (kind.startsWith("FIELD_")) return "شريك";
  if (kind.startsWith("CAPTAIN_") || ["HANDOFF_CONFIRMED", "PICKED_UP", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_RECOVERED", "REASSIGNED"].includes(kind)) return "توصيل";
  return "طلب";
}

export function notificationKindTone(kind: NotificationKind) {
  if (kind === "STORE_AVAILABILITY_CHANGED") return "partner";
  if (kind.startsWith("FIELD_")) return "partner";
  if (kind.startsWith("CAPTAIN_") || ["HANDOFF_CONFIRMED", "PICKED_UP", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_RECOVERED", "REASSIGNED"].includes(kind)) return "delivery";
  return "order";
}

export function notificationHref(item: Pick<Notification, "orderId" | "joiningCaseId" | "storeId">): string | null {
  if (item.joiningCaseId?.trim()) return `/partners/${encodeURIComponent(item.joiningCaseId.trim())}`;
  if (item.storeId?.trim()) return `/partners/stores/${encodeURIComponent(item.storeId.trim())}`;
  if (item.orderId.trim()) return `/operations/${encodeURIComponent(item.orderId.trim())}`;
  return null;
}

export function notificationTitle(item: Pick<Notification, "title" | "orderId">): string {
  return withoutInternalOrderKey(item.title, item.orderId);
}

export function notificationBody(item: Pick<Notification, "body" | "orderId">): string {
  return withoutInternalOrderKey(item.body, item.orderId);
}

function withoutInternalOrderKey(text: string, orderId: string): string {
  const internalKey = orderId.trim();
  if (!internalKey || !text.includes(internalKey)) return text;

  return text.split(internalKey).join("")
    .replace(/\s+رقم(?=[\s.,،؛])/gu, "")
    .replace(/\s{2,}/gu, " ")
    .replace(/\s+([.,،؛])/gu, "$1")
    .trim();
}
