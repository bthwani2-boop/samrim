import { darkThemeColors, lightThemeColors, type ThemeColors } from "../semantics/themes";

export function themeToCssVariables(themeColors: ThemeColors): Record<string, string> {
  return {
    "--brand-action": themeColors.brandAction,
    "--brand-structure": themeColors.brandStructure,
    "--brand-turquoise": themeColors.brandTurquoise,
    "--brand-burgundy": themeColors.brandBurgundy,
    "--brand-action-hover": themeColors.brandActionHover,
    "--brand-action-pressed": themeColors.brandActionPressed,
    "--brand-action-soft": themeColors.brandActionSoft,
    "--action-bg": themeColors.actionBackground,
    "--action-hover": themeColors.actionHover,
    "--action-pressed": themeColors.actionPressed,
    "--action-soft": themeColors.actionSoft,
    "--action-text": themeColors.actionText,
    "--interactive-text": themeColors.interactiveText,
    "--brand-structure-soft": themeColors.structureSoft,
    "--surface-warm": themeColors.background,
    "--surface-base": themeColors.surface,
    "--surface-muted": themeColors.surfaceInset,
    "--surface-overlay": themeColors.surfaceOverlay,
    "--overlay-scrim": themeColors.overlayScrim,
    "--text-muted": themeColors.colorMuted,
    "--color-primary": themeColors.color,
    "--color-secondary": themeColors.colorSecondary,
    "--color-inverse": themeColors.colorInverse,
    "--color-on-action": themeColors.onAction,
    "--border-subtle": themeColors.borderColor,
    "--border-strong": themeColors.borderColorStrong,
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
    "--disabled-bg": themeColors.disabledBackground,
    "--disabled-text": themeColors.disabledText,
    "--shadow-card": themeColors.shadowCard
  };
}

function formatCssVariables(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
}

export function generateThemeCss(): string {
  const lightVars = formatCssVariables(themeToCssVariables(lightThemeColors));
  const darkVars = formatCssVariables(themeToCssVariables(darkThemeColors));

  return `:root {
  color-scheme: light dark;
${lightVars}
}

:root[data-theme="light"] {
  color-scheme: light;
${lightVars}
}

:root[data-theme="dark"] {
  color-scheme: dark;
${darkVars}
}

@media (prefers-color-scheme: dark) {
  :root {
${darkVars}
  }
}
`;
}
