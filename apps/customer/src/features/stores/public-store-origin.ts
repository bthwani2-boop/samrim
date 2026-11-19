export function resolvePublicStoreOrigin(
  configured = process.env.EXPO_PUBLIC_DSH_API_URL ?? "",
  development = process.env.NODE_ENV === "development",
  browser = typeof document === "undefined" ? undefined : document.location,
) {
  if (configured || !development || !browser) return configured;
  return (browser.hostname === "localhost" || browser.hostname === "127.0.0.1") &&
    (browser.protocol === "http:" || browser.protocol === "https:") ? browser.origin : "";
}
