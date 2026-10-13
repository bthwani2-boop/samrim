import type { NotificationListResponse } from "@bthwani/dsh";

function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function parseOperatorNotificationList(input: unknown): NotificationListResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_OPERATOR_NOTIFICATIONS");
  const data = input as Record<string, unknown>;
  if (!Array.isArray(data.notifications) || !Number.isSafeInteger(data.unreadCount) || Number(data.unreadCount) < 0
    || (data.nextCursor !== undefined && (typeof data.nextCursor !== "string" || data.nextCursor.length > 1024))) {
    throw new Error("INVALID_OPERATOR_NOTIFICATIONS");
  }
  const seen = new Set<string>();
  for (const value of data.notifications) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OPERATOR_NOTIFICATIONS");
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || seen.has(item.id)
      || typeof item.kind !== "string" || !item.kind
      || typeof item.title !== "string" || typeof item.body !== "string"
      || typeof item.orderId !== "string" || !validDate(item.createdAt)
      || (item.readAt !== null && !validDate(item.readAt))) {
      throw new Error("INVALID_OPERATOR_NOTIFICATIONS");
    }
    seen.add(item.id);
  }
  return data as unknown as NotificationListResponse;
}
