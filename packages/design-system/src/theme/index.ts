import {
  borders,
  breakpoints,
  darkThemeColors,
  direction,
  elevation,
  fontFamilies,
  fontWeights,
  lightThemeColors,
  motion,
  opacity,
  radius,
  sizing,
  spacing,
  typography,
  zIndex,
  type ThemeColors
} from "../tokens/index";

export const themes = {
  light: lightThemeColors,
  dark: darkThemeColors
} as const;

export type ThemeName = keyof typeof themes;
export type UiTheme = ThemeColors;

export function resolveTheme(name?: string | null): ThemeColors {
  return name === "dark" ? darkThemeColors : lightThemeColors;
}

export function themeToCssVariables(themeColors: ThemeColors): Record<string, string> {
  return {
    "--brand-action": themeColors.action,
    "--brand-action-hover": themeColors.actionHover,
    "--brand-action-pressed": themeColors.actionPressed,
    "--brand-action-soft": themeColors.actionSoft,
    "--action-bg": themeColors.actionBackground,
    "--action-text": themeColors.actionText,
    "--interactive-text": themeColors.interactiveText,
    "--brand-structure": themeColors.structure,
    "--brand-structure-soft": themeColors.structureSoft,
    "--surface-warm": themeColors.background,
    "--surface-base": themeColors.surface,
    "--surface-muted": themeColors.surfaceInset,
    "--surface-overlay": themeColors.surfaceOverlay,
    "--text-muted": themeColors.colorMuted,
    "--color-primary": themeColors.color,
    "--color-secondary": themeColors.colorSecondary,
    "--color-inverse": themeColors.colorInverse,
    "--color-on-action": themeColors.onAction,
    "--border-subtle": themeColors.borderColor,
    "--border-strong": themeColors.borderColorStrong,
    "--focus-color": themeColors.focusColor,
    "--focus-ring": themeColors.focusRing,
    "--success": themeColors.success,
    "--success-soft": themeColors.successSoft,
    "--success-text": themeColors.successText,
    "--warning": themeColors.warning,
    "--warning-soft": themeColors.warningSoft,
    "--warning-text": themeColors.warningText,
    "--danger": themeColors.danger,
    "--danger-soft": themeColors.dangerSoft,
    "--danger-text": themeColors.dangerText,
    "--info": themeColors.info,
    "--info-soft": themeColors.infoSoft,
    "--info-text": themeColors.infoText,
    "--shadow-card": themeColors.shadowCard
  };
}

export function generateThemeCss(): string {
  const lightVars = Object.entries(themeToCssVariables(lightThemeColors))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  const darkVars = Object.entries(themeToCssVariables(darkThemeColors))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return `:root {
  color-scheme: light dark;
${lightVars}
}

@media (prefers-color-scheme: dark) {
  :root {
${darkVars}
  }
}
`;
}

export const themeKernel = {
  themes,
  resolveTheme,
  themeToCssVariables,
  generateThemeCss,
  spacing,
  radius,
  elevation,
  motion,
  sizing,
  breakpoints,
  typography,
  fontFamilies,
  fontWeights,
  borders,
  opacity,
  zIndex,
  direction
} as const;

export const theme = themeKernel;
export type ThemeKernel = typeof themeKernel;
