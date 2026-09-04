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
  zIndex
} from "../tokens/index";

export const themes = {
  light: lightThemeColors,
  dark: darkThemeColors
} as const;

export const themeKernel = {
  themes,
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

export type ThemeName = keyof typeof themes;
export type UiTheme = (typeof themes)[ThemeName];
export type ThemeKernel = typeof themeKernel;
