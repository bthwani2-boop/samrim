// Shared WLT readback field validation and isolated native-origin admission.
// The WLT Go boundary counts Unicode scalar values and uses strings.TrimSpace
// and unicode.IsControl. JavaScript trim includes BOM and is not equivalent.
export function actorValid(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 &&
    !/^\p{White_Space}|\p{White_Space}$|[\p{Cc}\p{Cs}]/u.test(id) &&
    Array.from(id).length <= 128;
}

// Whole YER stays decimal text: never coerce through a JS Number.
export function amountValid(value: unknown, positive: boolean): value is string {
  return typeof value === "string" &&
    /^(0|[1-9][0-9]{0,37})$/.test(value) && (!positive || value !== "0");
}

export function fundingIdValid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(value);
}

function emulatorPort(origin: string): number | null {
  const match = /^http:\/\/10\.0\.2\.2:([1-9][0-9]{0,4})$/.exec(origin);
  if (!match) return null;
  const port = Number(match[1]);
  return port <= 65535 ? port : null;
}

// Native finance requires an explicitly configured Android emulator with
// distinct local Identity and WLT owners. Never coerce a bridge value to an
// origin. This is connectivity admission, not owner authorization.
export function isolatedNativeWltOrigin(
  platform: string, isDevice: boolean | null | undefined,
  identityOrigin: string | undefined, wltOrigin: string | undefined,
): string | null {
  if (platform !== "android" || isDevice !== false ||
      typeof identityOrigin !== "string" || typeof wltOrigin !== "string") return null;
  const identity = emulatorPort(identityOrigin);
  const wallet = emulatorPort(wltOrigin);
  return identity !== null && wallet !== null && identity !== wallet ? wltOrigin : null;
}
