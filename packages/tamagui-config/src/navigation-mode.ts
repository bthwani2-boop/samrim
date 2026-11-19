export function usesDesktopNavigation(platform: string, width: number): boolean {
  return platform === "web" && Number.isFinite(width) && width >= 1024;
}
