import { defaultConfig } from "@tamagui/config/v6";
import { createTamagui } from "tamagui";

// Use the official Tamagui tokens and themes across all Expo surfaces.
// The existing appearance controller owns user preference and published colors
// until its consumers are fully migrated; avoid introducing a second writer.
export const tamaguiConfig = createTamagui(defaultConfig);

type BthwaniTamaguiConfig = typeof tamaguiConfig;

declare module "tamagui" {
  interface TamaguiCustomConfig extends BthwaniTamaguiConfig {}
}
