import { defaultConfig } from "@tamagui/config/v6";
import { createTamagui } from "tamagui";
import { themes as brandThemes } from "@bthwani/design-system/theme";

// Tamagui is the sole UI primitive renderer for Customer/Merchant/Captain.
// Every application theme role comes from the one BThwani semantic token owner.
function makeTheme(mode: "light" | "dark") {
  const source = brandThemes[mode];
  return {
    ...defaultConfig.themes[mode],
    background: source.background,
    backgroundHover: source.surfaceRaised,
    backgroundPress: source.surfaceInset,
    backgroundFocus: source.surfaceRaised,
    backgroundStrong: source.structure,
    backgroundTransparent: "transparent",
    color: source.color,
    colorHover: source.color,
    colorPress: source.color,
    colorFocus: source.color,
    colorStrong: source.color,
    colorWeak: source.colorSecondary,
    placeholderColor: source.colorMuted,
    borderColor: source.borderColor,
    borderColorHover: source.borderColorStrong,
    borderColorFocus: source.focusRing,
    outlineColor: source.focusRing,
    shadowColor: source.shadowColor,
    actionBackground: source.actionBackground,
    actionText: source.onAction,
    success: source.success,
    danger: source.danger,
  };
}
export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  // Expose only BThwani-approved roots. The 200+ generic example themes
  // from defaultConfig are not an additional mutable visual palette.
  // Add specialized subthemes only when an actual consumer needs them.
  themes: {
    light: makeTheme("light"),
    dark: makeTheme("dark"),
  },
});
type BthwaniTamaguiConfig = typeof tamaguiConfig;
declare module "tamagui" {
  interface TamaguiCustomConfig extends BthwaniTamaguiConfig {}
}
