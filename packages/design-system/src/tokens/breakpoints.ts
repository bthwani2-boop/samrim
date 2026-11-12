export const breakpoints = {
  xs: 0,
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  wide: 1440
} as const;

export const media = {
  xs: { minWidth: breakpoints.xs },
  sm: { minWidth: breakpoints.sm },
  md: { minWidth: breakpoints.md },
  lg: { minWidth: breakpoints.lg },
  xl: { minWidth: breakpoints.xl },
  wide: { minWidth: breakpoints.wide },
  smOnly: { minWidth: breakpoints.sm, maxWidth: breakpoints.md - 1 },
  mdOnly: { minWidth: breakpoints.md, maxWidth: breakpoints.lg - 1 },
  mobile: { maxWidth: breakpoints.md - 1 }
} as const;

export type BreakpointToken = keyof typeof breakpoints;
export type MediaToken = keyof typeof media;
