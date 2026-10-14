// A notification can reference non-order events. Never turn untrusted IDs into URLs.
export function operationNotificationHref(orderId: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(orderId)) return null;
  return `/operations/${encodeURIComponent(orderId)}?tab=overview`;
}
