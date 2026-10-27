export type RepeatOrderLease = Readonly<{
  actorID: string;
  orderID: string;
}>;

export type RepeatOrderGate = { current: RepeatOrderLease | null };

export function createRepeatOrderGate(): RepeatOrderGate {
  return { current: null };
}

export function acquireRepeatOrder(
  gate: RepeatOrderGate,
  actorID: string,
  orderID: string,
): RepeatOrderLease | null {
  if (!actorID.trim() || gate.current?.actorID === actorID) return null;
  const lease = { actorID, orderID };
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

export function invalidateRepeatOrderForActorChange(
  gate: RepeatOrderGate,
  activeActorID: string,
): RepeatOrderLease | null {
  const current = gate.current;
  if (!current || current.actorID === activeActorID) return null;
  gate.current = null;
  return current;
}
