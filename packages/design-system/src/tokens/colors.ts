export const brandRoots = {
  brandAction: "#FF500D",
  surfaceBase: "#FFFFFF",
  brandStructure: "#0A2F5C"
} as const;

export type BrandRoot = keyof typeof brandRoots;

export function alpha(color: string, opacity: number): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
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
    50: "#FFF3ED",
    100: "#FFE2D4",
    200: "#FFC0A3",
    300: "#FF9A6B",
    400: "#FF7138",
    500: brandRoots.brandAction,
    600: "#E5480C",
    700: "#B73809",
    800: "#8C2B07",
    900: "#641F05"
  },
  structure: {
    50: "#EEF5FC",
    100: "#D8E7F7",
    200: "#B4CFEA",
    300: "#86AED8",
    400: "#4E83BD",
    500: "#275F96",
    600: brandRoots.brandStructure,
    700: "#082744",
    800: "#061D33",
    900: "#041322"
  },
  surface: {
    0: brandRoots.surfaceBase,
    50: "#FFFCF8",
    100: "#F8F5F0",
    200: "#EFE9E0",
    300: "#E3DACE",
    400: "#D2C7B8"
  }
} as const;

export const colorRoles = {
  brandAction: brandRoots.brandAction,
  brandActionHover: brandScale.action[600],
  brandActionPressed: brandScale.action[700],
  brandActionSoft: brandScale.action[50],
  brandActionTint: alpha(brandRoots.brandAction, 0.12),

  surfaceBase: brandRoots.surfaceBase,
  surfaceWarm: brandScale.surface[50],
  surfaceMuted: brandScale.surface[100],
  surfaceInset: brandScale.surface[200],
  surfaceOverlay: alpha(brandRoots.surfaceBase, 0.86),
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
  focusRing: alpha(brandRoots.brandAction, 0.34),

  success: "#1F8B4C",
  warning: "#B96A06",
  danger: "#C43B35",
  info: "#295FAA",

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

export const lightThemeColors = {
  background: brandScale.surface[50],
  backgroundAlt: brandRoots.surfaceBase,
  surface: brandRoots.surfaceBase,
  surfaceRaised: brandScale.surface[50],
  surfaceInset: brandScale.surface[100],
  surfaceOverlay: colorRoles.surfaceOverlay,
  color: colorRoles.textPrimary,
  colorSecondary: colorRoles.textSecondary,
  colorMuted: colorRoles.textMuted,
  colorInverse: colorRoles.textInverse,
  borderColor: colorRoles.borderSubtle,
  borderColorStrong: colorRoles.borderStrong,
  focusColor: colorRoles.focusRing,
  action: colorRoles.brandAction,
  actionHover: colorRoles.brandActionHover,
  actionPressed: colorRoles.brandActionPressed,
  actionSoft: colorRoles.brandActionSoft,
  structure: colorRoles.brandStructure,
  structureSoft: colorRoles.brandStructureSoft,
  success: statusScale.success,
  successSoft: statusScale.successSoft,
  warning: statusScale.warning,
  warningSoft: statusScale.warningSoft,
  danger: statusScale.danger,
  dangerSoft: statusScale.dangerSoft,
  info: statusScale.info,
  infoSoft: statusScale.infoSoft,
  shadowColor: colorRoles.shadowBase
} as const;

export const darkThemeColors = {
  background: neutralScale[950],
  backgroundAlt: neutralScale[900],
  surface: neutralScale[900],
  surfaceRaised: neutralScale[800],
  surfaceInset: neutralScale[950],
  surfaceOverlay: alpha(neutralScale[900], 0.9),
  color: neutralScale[50],
  colorSecondary: neutralScale[200],
  colorMuted: neutralScale[400],
  colorInverse: brandRoots.brandStructure,
  borderColor: alpha(neutralScale[0], 0.12),
  borderColorStrong: alpha(neutralScale[0], 0.2),
  focusColor: alpha(brandRoots.brandAction, 0.5),
  action: brandRoots.brandAction,
  actionHover: brandScale.action[400],
  actionPressed: brandScale.action[300],
  actionSoft: alpha(brandRoots.brandAction, 0.18),
  structure: neutralScale[50],
  structureSoft: neutralScale[800],
  success: "#4ADE80",
  successSoft: alpha("#4ADE80", 0.14),
  warning: "#F5C04E",
  warningSoft: alpha("#F5C04E", 0.14),
  danger: "#F2877A",
  dangerSoft: alpha("#F2877A", 0.14),
  info: "#8BB4E8",
  infoSoft: alpha("#8BB4E8", 0.14),
  shadowColor: colorRoles.shadowBase
} as const;

export const tamaguiColorTokens = {
  ...colorRoles,
  ...statusScale
} as const;

export const colorPalette = {
  white: "#FFFFFF",
  black: "#000000",
  redMuted: "#E53935",
  orangeMuted: "#F59E0B",
  orangeSoft: "#FFF3E0",
  redSoft: "#FFEBEE",
  yellowSoft: "#FFF8E1",
  greenSoft: "#E6F9F0",
  dangerSoft: "#FEE8E8",
  infoSoft: "#EAF0FB",
  warningSoft: "#FEF6E4",
  graySoft: "#F3F4F6",
  greenStrong: "#0E7A45",
  dangerStrong: "#C0392B",
  warningStrong: "#B45309",
  grayBorder: "#ECECEC",
  tanBg: "#F5ECE3",
} as const;
