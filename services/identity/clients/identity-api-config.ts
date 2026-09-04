declare const process:
  | { readonly env?: Readonly<Record<string, string | undefined>> }
  | undefined;

function isReactNative(): boolean {
  return typeof navigator !== "undefined" && navigator.product === "ReactNative";
}

function isIdentityDeviceLoopbackBridgeEnabled(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  const expoFlag = process.env.EXPO_PUBLIC_ADB_REVERSE_ENABLED?.trim().toLowerCase();
  const runtimeFlag = process.env.BTHWANI_ADB_REVERSE_ENABLED?.trim().toLowerCase();
  return expoFlag === "true" || runtimeFlag === "1" || runtimeFlag === "true";
}

/**
 * Resolve the Identity transport at the Identity package boundary.
 * The control panel may use a same-origin HttpOnly BFF. The governed mobile
 * launcher injects an explicit native URL: LAN uses the Mobile Dev Gateway and
 * ADB uses verified loopback reverse. The Android-emulator/loopback values below
 * are development fallbacks only when the governed launcher did not inject one.
 */
export function resolveIdentityApiBaseUrl(): string {
  if (
    typeof process !== "undefined" &&
    process.env?.["NEXT_PUBLIC_CONTROL_PANEL_BFF_ENABLED"] === "true"
  ) {
    return "/api/identity";
  }

  if (typeof process !== "undefined" && process.env) {
    const configured =
      process.env.EXPO_PUBLIC_IDENTITY_API_BASE_URL ??
      process.env.NEXT_PUBLIC_IDENTITY_API_BASE_URL;
    if (configured && configured.trim().length > 0) return configured.trim();
  }

  return isReactNative() && !isIdentityDeviceLoopbackBridgeEnabled()
      ? "http://10.0.2.2:18082"
      : "http://127.0.0.1:18082";
}
