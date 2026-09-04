export const fontFamilies = {
  arabic: "system-ui",
  latin: "system-ui",
  display: "system-ui",
  mono: "ui-monospace"
} as const;

export const fontWeights = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  black: "800"
} as const;

export const typography = {
  display: { fontSize: 36, lineHeight: 44, fontWeight: fontWeights.bold, letterSpacing: -0.4 },
  hero: { fontSize: 30, lineHeight: 38, fontWeight: fontWeights.bold, letterSpacing: -0.3 },
  titleLg: { fontSize: 24, lineHeight: 32, fontWeight: fontWeights.bold, letterSpacing: -0.2 },
  titleMd: { fontSize: 20, lineHeight: 28, fontWeight: fontWeights.semibold, letterSpacing: 0 },
  titleSm: { fontSize: 18, lineHeight: 26, fontWeight: fontWeights.semibold, letterSpacing: 0 },
  bodyLg: { fontSize: 17, lineHeight: 27, fontWeight: fontWeights.regular, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 24, fontWeight: fontWeights.regular, letterSpacing: 0 },
  bodyStrong: { fontSize: 15, lineHeight: 24, fontWeight: fontWeights.semibold, letterSpacing: 0 },
  bodySm: { fontSize: 14, lineHeight: 21, fontWeight: fontWeights.regular, letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: fontWeights.semibold, letterSpacing: 0.1 },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: fontWeights.medium, letterSpacing: 0.1 },
  code: { fontSize: 13, lineHeight: 19, fontWeight: fontWeights.medium, letterSpacing: 0 }
} as const;

export type TypographyRole = keyof typeof typography | "labelLg" | "labelMd" | "bodyMd" | "headingSm" | undefined;
export type FontFamilyToken = keyof typeof fontFamilies;
export type FontWeightToken = keyof typeof fontWeights;
