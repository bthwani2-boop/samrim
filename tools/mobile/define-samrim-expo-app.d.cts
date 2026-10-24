import type { ExpoConfig } from "expo/config";

export function defineSamrimExpoApp(
  appKey: string,
  options?: { cameraMode?: "barcode"; locationMode?: "foreground" | "background"; maps?: boolean; web?: boolean },
): ExpoConfig;
