/** Notification payloads are untrusted. Only explicit in-app destinations may be followed. */
export function resolveNotificationDestination(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  if (value === "/orders" || value === "/stores" || value === "/wallet") return value;
  return /^\/(?:orders|store)\/[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : null;
}
