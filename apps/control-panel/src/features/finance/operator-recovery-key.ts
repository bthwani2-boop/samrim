// A recovery record belongs to exactly one authenticated operator in this browser tab.
export function operatorRecoveryStorageKey(base: string, operatorActorId: string): string | null {
  const actor = operatorActorId.trim();
  return actor ? base + ":" + encodeURIComponent(actor) : null;
}
