export function claimCaptainPayoutSubmission(lock: { current: boolean }): (() => void) | null {
  if (lock.current) return null;
  lock.current = true;
  return () => { lock.current = false; };
}
