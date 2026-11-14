import { alpha, brandRoots, brandScale, colorRoles, neutralScale, statusScale } from "../brand/colors";

export const lightThemeColors = {
  brandAction: colorRoles.brandAction,
  brandStructure: brandRoots.brandStructure,
  brandTurquoise: colorRoles.brandTurquoise,
  brandBurgundy: colorRoles.brandBurgundy,
  brandActionHover: colorRoles.brandActionHover,
  brandActionPressed: colorRoles.brandActionPressed,
  brandActionSoft: colorRoles.brandActionSoft,
  background: brandScale.surface[50],
  backgroundAlt: brandRoots.surfaceBase,
  surface: brandRoots.surfaceBase,
  surfaceRaised: brandScale.surface[50],
  surfaceInset: brandScale.surface[100],
  surfaceOverlay: colorRoles.surfaceOverlay,
  overlayScrim: colorRoles.overlayScrim,
  color: colorRoles.textPrimary,
  colorSecondary: colorRoles.textSecondary,
  colorMuted: colorRoles.textMuted,
  colorInverse: colorRoles.textInverse,
  borderColor: colorRoles.borderSubtle,
  borderColorStrong: colorRoles.borderStrong,
  focusRing: brandScale.action[700],
  actionBackground: brandScale.action[700],
  actionHover: brandScale.action[800],
  actionPressed: brandScale.action[900],
  actionSoft: brandScale.action[50],
  actionText: brandScale.action[700],
  interactiveText: brandScale.action[700],
  structure: colorRoles.brandStructure,
  structureSoft: colorRoles.brandStructureSoft,
  success: statusScale.successStrong,
  successSoft: statusScale.successSoft,
  successText: statusScale.successStrong,
  warning: statusScale.warningStrong,
  warningSoft: statusScale.warningSoft,
  warningText: statusScale.warningStrong,
  danger: statusScale.dangerStrong,
  dangerSoft: statusScale.dangerSoft,
  dangerText: statusScale.dangerStrong,
  info: statusScale.infoStrong,
  infoSoft: statusScale.infoSoft,
  infoText: statusScale.infoStrong,
  disabledBackground: brandScale.surface[100],
  disabledText: brandScale.structure[500],
  onAction: brandRoots.surfaceBase,
  shadowColor: colorRoles.shadowBase,
  shadowCard: `0 22px 60px ${alpha(brandRoots.brandStructure, 0.1)}`
} as const;

export const darkThemeColors = {
  brandAction: colorRoles.brandAction,
  brandStructure: brandRoots.brandStructure,
  brandTurquoise: colorRoles.brandTurquoise,
  brandBurgundy: colorRoles.brandBurgundy,
  brandActionHover: brandScale.action[300],
  brandActionPressed: brandScale.action[200],
  brandActionSoft: alpha(brandRoots.brandAction, 0.18),
  background: neutralScale[950],
  backgroundAlt: neutralScale[900],
  surface: neutralScale[900],
  surfaceRaised: neutralScale[800],
  surfaceInset: neutralScale[800],
  surfaceOverlay: alpha(neutralScale[900], 0.9),
  overlayScrim: colorRoles.overlayScrim,
  color: neutralScale[50],
  colorSecondary: neutralScale[200],
  colorMuted: neutralScale[400],
  colorInverse: brandRoots.brandStructure,
  borderColor: alpha(neutralScale[0], 0.12),
  borderColorStrong: alpha(neutralScale[0], 0.2),
  focusRing: brandScale.action[300],
  actionBackground: brandScale.action[400],
  actionHover: brandScale.action[300],
  actionPressed: brandScale.action[200],
  actionSoft: alpha(brandRoots.brandAction, 0.18),
  actionText: brandScale.action[300],
  interactiveText: brandScale.action[300],
  structure: neutralScale[50],
  structureSoft: neutralScale[800],
  success: "#4ADE80",
  successSoft: alpha("#4ADE80", 0.14),
  successText: "#4ADE80",
  warning: "#F5C04E",
  warningSoft: alpha("#F5C04E", 0.14),
  warningText: "#F5C04E",
  danger: "#F2877A",
  dangerSoft: alpha("#F2877A", 0.14),
  dangerText: "#F2877A",
  info: "#8BB4E8",
  infoSoft: alpha("#8BB4E8", 0.14),
  infoText: "#8BB4E8",
  disabledBackground: neutralScale[800],
  disabledText: neutralScale[400],
  onAction: neutralScale[950],
  shadowColor: colorRoles.shadowBase,
  shadowCard: "0 22px 60px rgba(0, 0, 0, 0.5)"
} as const;

export type ThemeColors = {
  [K in keyof typeof lightThemeColors]: string;
};

export const themes = {
  light: lightThemeColors,
  dark: darkThemeColors
} as const;

export type ThemeName = keyof typeof themes;
export type UiTheme = ThemeColors;

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && themePreferences.includes(value as ThemePreference);
}

export function resolveThemeName(
  preference?: string | null,
  systemColorScheme?: "light" | "dark" | "unspecified" | null,
): ThemeName {
  if (preference === "light" || preference === "dark") return preference;
  return systemColorScheme === "dark" ? "dark" : "light";
}

export function resolveTheme(name?: string | null): ThemeColors {
  return name === "dark" ? darkThemeColors : lightThemeColors;
}
