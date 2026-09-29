export type OrderConversationRole = "client" | "partner" | "captain";

export type OrderConversationMessageAttempt = Readonly<{
  version: 1;
  actorID: string;
  orderID: string;
  body: string;
  idempotencyKey: string;
  correlationID: string;
}>;

export function orderConversationMessageAttemptStorageKey(role: OrderConversationRole, actorID: string, orderID: string): string {
  const normalizedActor = actorID.trim();
  const normalizedOrder = orderID.trim();
  if (!normalizedActor || normalizedActor.length > 128 || !normalizedOrder || normalizedOrder.length > 128) {
    throw new Error("DSH_ORDER_CONVERSATION_ATTEMPT_SCOPE_INVALID");
  }
  return `bthwani.dsh.order-conversation.v1.${role}.${encodeURIComponent(normalizedActor)}.${encodeURIComponent(normalizedOrder)}`;
}

export function createOrderConversationMessageAttempt(
  actorID: string,
  orderID: string,
  body: string,
  idempotencyKey: string,
  correlationID: string,
): OrderConversationMessageAttempt {
  const normalizedActor = actorID.trim();
  const normalizedOrder = orderID.trim();
  const normalizedBody = body.trim();
  const normalizedKey = idempotencyKey.trim();
  const normalizedCorrelation = correlationID.trim();
  if (
    !normalizedActor || normalizedActor.length > 128 ||
    !normalizedOrder || normalizedOrder.length > 128 ||
    Array.from(normalizedBody).length < 1 || Array.from(normalizedBody).length > 2000 ||
    normalizedKey.length < 8 || normalizedKey.length > 128 ||
    normalizedCorrelation.length < 8 || normalizedCorrelation.length > 128
  ) {
    throw new Error("DSH_ORDER_CONVERSATION_ATTEMPT_INVALID");
  }
  return {
    version: 1,
    actorID: normalizedActor,
    orderID: normalizedOrder,
    body: normalizedBody,
    idempotencyKey: normalizedKey,
    correlationID: normalizedCorrelation,
  };
}

export async function clearOrderConversationMessageAttempt(
  role: OrderConversationRole,
  attempt: OrderConversationMessageAttempt,
  removeStoredItem: (key: string) => Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  try {
    await removeStoredItem(orderConversationMessageAttemptStorageKey(role, attempt.actorID, attempt.orderID));
    return true;
  } catch (error_) {
    onFailure(error_);
    return false;
  }
}

export function parseOrderConversationMessageAttempt(
  raw: string | null,
  actorID: string,
  orderID: string,
): OrderConversationMessageAttempt | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("DSH_ORDER_CONVERSATION_ATTEMPT_INVALID");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("DSH_ORDER_CONVERSATION_ATTEMPT_INVALID");
  }
  const attempt = value as Partial<OrderConversationMessageAttempt>;
  if (attempt.version !== 1 || attempt.actorID !== actorID.trim() || attempt.orderID !== orderID.trim()) {
    throw new Error("DSH_ORDER_CONVERSATION_ATTEMPT_SCOPE_MISMATCH");
  }
  return createOrderConversationMessageAttempt(
    attempt.actorID,
    attempt.orderID,
    typeof attempt.body === "string" ? attempt.body : "",
    typeof attempt.idempotencyKey === "string" ? attempt.idempotencyKey : "",
    typeof attempt.correlationID === "string" ? attempt.correlationID : "",
  );
}
