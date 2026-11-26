// WLT's field checks and shared native finance origin admission.
export const actorValid = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && Array.from(id).length <= 128 &&
  id.trim() === id && !/\p{Cc}/u.test(id);
export const amountValid = (value: unknown, positive: boolean): value is string =>
  typeof value === "string" &&
  (positive ? /^[1-9][0-9]{0,37}$/ : /^(0|[1-9][0-9]{0,37})$/).test(value);
export const fundingIdValid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(value);

// Native finance is admitted only on an explicitly configured Android emulator
// with distinct local Identity and WLT owners. Call before accessing a session.
// This is not authorization: each owner still verifies the bearer and scope.
export function isolatedNativeWltOrigin(
  platform: string, isDevice: boolean | null | undefined,
  identityOrigin: string | undefined, wltOrigin: string | undefined,
): string | null {
  if (platform !== "android" || isDevice !== false) return null;
  function emulatorPort(origin: string | undefined): number | null {
    const match = /^http:\/\/10\.0\.2\.2:([1-9][0-9]{0,4})$/.exec(origin ?? "");
    return match && Number(match[1]) <= 65535 ? Number(match[1]) : null;
  }
  const identity = emulatorPort(identityOrigin);
  const wallet = emulatorPort(wltOrigin);
  return identity !== null && wallet !== null && identity !== wallet ? wltOrigin ?? null : null;
}
