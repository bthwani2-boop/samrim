import type { ExpoConfig } from "expo/config";

export function defineSamrimExpoApp(
  appKey: string,
  options?: { locationMode?: "foreground" | "background" },
): ExpoConfig;
