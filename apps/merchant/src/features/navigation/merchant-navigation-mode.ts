/**
 * Presentation only: both modes retain the same Expo routes and owner permissions.
 * Server rendering and small devices default to native bottom tabs.
 */
export function merchantNavigationMode(platform: string, windowWidth: number): "mobile" | "desktop" {
  return platform === "web" && Number.isFinite(windowWidth) && windowWidth >= 1024
    ? "desktop"
    : "mobile";
}
