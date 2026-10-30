export const brandRoots = {
  brandAction: "#F36B21",
  surfaceBase: "#FFFFFF",
  brandStructure: "#102B4E",
  brandTurquoise: "#83DDF3",
  brandBurgundy: "#7B1E3A"
} as const;

export type BrandRoot = keyof typeof brandRoots;

export function alpha(color: string, opacity: number): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const rgbMatch = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  const normalized = color.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((value) => `${value}${value}`)
          .join("")
      : normalized;

  if (expanded.length !== 6) {
    throw new Error(`Invalid hex color: ${color}`);
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export const brandScale = {
  action: {
    50: "#FFF7F0",
    100: "#FDE9D9",
    200: "#FBCBAD",
    300: "#F8AB7D",
    400: "#F58B50",
    500: brandRoots.brandAction,
    600: "#D95B19",
    700: "#C2410C",
    800: "#9A3412",
    900: "#7C2D12"
  },
  structure: {
    50: "#ECF3F8",
    100: "#D8E5EF",
    200: "#AEC9DD",
    300: "#7AA5C5",
    400: "#477DA5",
    500: "#205677",
    600: brandRoots.brandStructure,
    700: "#0D2442",
    800: "#0A1E37",
    900: "#071628"
  },
  surface: {
    0: brandRoots.surfaceBase,
    50: "#FFF7F0",
    100: "#F8F5F0",
    200: "#EFE9E0",
    300: "#E3DACE",
    400: "#D2C7B8"
  }
} as const;

export const statusScale = {
  successSoft: "#ECFDF3",
  success: "#1F8B4C",
  successStrong: "#16653A",
  warningSoft: "#FFFBEB",
  warning: "#B96A06",
  warningStrong: "#8E5204",
  dangerSoft: "#FEF2F2",
  danger: "#C43B35",
  dangerStrong: "#9B2F2B",
  infoSoft: "#EFF6FF",
  info: "#295FAA",
  infoStrong: "#214D89"
} as const;

export const colorRoles = {
  brandAction: brandRoots.brandAction,
  brandTurquoise: brandRoots.brandTurquoise,
  brandBurgundy: brandRoots.brandBurgundy,
  brandActionHover: brandScale.action[600],
  brandActionPressed: brandScale.action[700],
  brandActionSoft: brandScale.action[50],
  brandActionTint: alpha(brandRoots.brandAction, 0.12),

  surfaceBase: brandRoots.surfaceBase,
  surfaceWarm: brandScale.surface[50],
  surfaceMuted: brandScale.surface[100],
  surfaceInset: brandScale.surface[200],
  surfaceOverlay: alpha(brandRoots.surfaceBase, 0.86),
  overlayScrim: alpha("#020617", 0.57),
  mediaScrimStrong: alpha("#0F172A", 0.78),

  brandStructure: brandRoots.brandStructure,
  brandStructureElevated: brandScale.structure[500],
  brandStructureSoft: brandScale.structure[50],
  brandStructureTint: alpha(brandRoots.brandStructure, 0.12),

  textPrimary: brandRoots.brandStructure,
  textSecondary: brandScale.structure[500],
  textMuted: alpha(brandRoots.brandStructure, 0.68),
  textInverse: brandRoots.surfaceBase,
  textOnMediaMuted: alpha(brandRoots.surfaceBase, 0.4),
  textOnMediaStrong: alpha(brandRoots.surfaceBase, 0.9),

  borderSubtle: alpha(brandRoots.brandStructure, 0.1),
  borderStrong: alpha(brandRoots.brandStructure, 0.18),
  focusRing: brandScale.action[700],

  actionBackground: brandScale.action[700],
  actionText: brandScale.action[700],
  interactiveText: brandScale.action[700],

  success: statusScale.successStrong,
  successText: statusScale.successStrong,
  warning: statusScale.warningStrong,
  warningText: statusScale.warningStrong,
  danger: statusScale.dangerStrong,
  dangerText: statusScale.dangerStrong,
  info: statusScale.infoStrong,
  infoText: statusScale.infoStrong,

  shadowBase: "#000000"
} as const;

export type ColorRole = keyof typeof colorRoles;

export const neutralScale = {
  0: "#FFFFFF",
  50: "#F8FAFC",
  100: "#F1F5F9",
  200: "#E2E8F0",
  300: "#CBD5E1",
  400: "#94A3B8",
  500: "#64748B",
  600: "#475569",
  700: "#334155",
  800: "#1E293B",
  900: "#0F172A",
  950: "#020617"
} as const;

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
