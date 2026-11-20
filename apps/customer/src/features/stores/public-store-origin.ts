export function resolvePublicStoreOrigin(
  configured = process.env.EXPO_PUBLIC_DSH_API_URL ?? "",
  development = process.env.NODE_ENV === "development",
  browser = typeof document === "undefined" ? undefined : document.location,
) {
  if (configured || !development) return configured;
  // Android dev-client uses adb reverse 18101 -> Surface tunnel -> Customer Expo API.
  // Production must explicitly configure an HTTPS owner endpoint.
  if (!browser) return "http://127.0.0.1:18101";
  return (browser.hostname === "localhost" || browser.hostname === "127.0.0.1") &&
    (browser.protocol === "http:" || browser.protocol === "https:") ? browser.origin : "";
}
