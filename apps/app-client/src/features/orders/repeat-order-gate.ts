export type RepeatOrderLease = Readonly<{
  sessionKey: string;
  orderID: string;
}>;

export type RepeatOrderGate = { current: RepeatOrderLease | null };

export function createRepeatOrderGate(): RepeatOrderGate {
  return { current: null };
}

export function acquireRepeatOrder(
  gate: RepeatOrderGate,
  sessionKey: string,
  orderID: string,
): RepeatOrderLease | null {
  if (!sessionKey.trim() || gate.current?.sessionKey === sessionKey) return null;
  const lease = { sessionKey, orderID };
  gate.current = lease;
  return lease;
}

export function ownsRepeatOrder(gate: RepeatOrderGate, lease: RepeatOrderLease): boolean {
  return gate.current === lease;
}

export function releaseRepeatOrder(gate: RepeatOrderGate, lease: RepeatOrderLease): boolean {
  if (!ownsRepeatOrder(gate, lease)) return false;
  gate.current = null;
  return true;
}

export function invalidateRepeatOrderForSessionChange(
  gate: RepeatOrderGate,
  activeSessionKey: string,
): RepeatOrderLease | null {
  const current = gate.current;
  if (!current || current.sessionKey === activeSessionKey) return null;
  gate.current = null;
  return current;
}
