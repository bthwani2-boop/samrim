export type FieldDraftMutationLock = { current: boolean };

// React state updates are asynchronous, so a ref is needed to reject a second
// submit synchronously before it can create a different idempotency key.
export function tryAcquireFieldDraftMutation(lock: FieldDraftMutationLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}
