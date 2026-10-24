/**
 * A push only carries identifiers, never trusted navigation instructions.
 * The current authenticated actor is checked again before opening a route.
 */
export function clientPushDestination(
  expectedActor: string,
  data: Record<string, unknown> | undefined,
): string | null {
  if (!expectedActor || !data || data.actorId !== expectedActor) return null;
  const orderId = data.orderId;
  if (typeof orderId === "string" && /^[A-Za-z0-9._~-]{1,160}$/.test(orderId)) {
    return `/orders/${encodeURIComponent(orderId)}`;
  }
  const notificationId = data.notificationId;
  if (typeof notificationId === "string" && /^share:[0-9]{1,19}$/.test(notificationId)) {
    return "/notifications";
  }
  return null;
}
