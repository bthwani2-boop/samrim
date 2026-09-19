import {
  borders,
  breakpoints,
  darkThemeColors,
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
  type ThemeColors,
  zIndex
} from "../tokens/index";

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

export function themeToCssVariables(themeColors: ThemeColors): Record<string, string> {
  return {
    "--brand-action": themeColors.brandAction,
    "--brand-structure": themeColors.structure,
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

function px(value: number): string {
  return `${value}px`;
}

function cssTokenEntries<T extends Record<string, number>>(prefix: string, values: T, unit = "px") {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [`--${prefix}-${name}`, `${value}${unit}`]));
}

/**
 * The canonical browser projection of the shared token kernel.
 * React Native continues to consume the numeric source tokens directly;
 * browser consumers use this generated, unit-bearing CSS projection.
 */
export function webFoundationToCssVariables(): Record<string, string> {
  const variables: Record<string, string> = {
    ...cssTokenEntries("space", spacing),
    ...cssTokenEntries("radius", radius),
    ...cssTokenEntries("size", sizing),
    ...cssTokenEntries("breakpoint", breakpoints),
    ...cssTokenEntries("border", borders),
    ...cssTokenEntries("opacity", opacity, ""),
    ...cssTokenEntries("z", zIndex, ""),
    "--duration-reduced": px(motion.reducedMotionDuration),
  };

  for (const [name, value] of Object.entries(motion.duration)) {
    variables[`--duration-${name}`] = px(value);
  }
  for (const [name, value] of Object.entries(motion.easing)) {
    variables[`--easing-${name}`] = value;
  }
  for (const [name, value] of Object.entries(fontFamilies)) {
    variables[`--font-family-${name}`] = value;
  }
  for (const [name, value] of Object.entries(fontWeights)) {
    variables[`--font-weight-${name}`] = value;
  }
  for (const [name, value] of Object.entries(typography)) {
    variables[`--font-size-${name}`] = px(value.fontSize);
    variables[`--line-height-${name}`] = px(value.lineHeight);
    variables[`--font-weight-${name}`] = value.fontWeight;
    variables[`--letter-spacing-${name}`] = px(value.letterSpacing);
  }
  for (const [name, value] of Object.entries(elevation)) {
    variables[`--elevation-${name}`] = `${px(value.shadowOffset.width)} ${px(value.shadowOffset.height)} ${px(value.shadowRadius)} ${value.shadowColor}`;
  }

  return variables;
}

function formatCssVariables(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
}

export function generateThemeCss(): string {
  const foundationVars = formatCssVariables(webFoundationToCssVariables());
  const lightVars = formatCssVariables(themeToCssVariables(lightThemeColors));
  const darkVars = formatCssVariables(themeToCssVariables(darkThemeColors));

  return `:root {
  color-scheme: light dark;
${foundationVars}
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
