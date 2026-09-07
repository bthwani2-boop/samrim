export const opacity = {
  invisible: 0,
  disabled: 0.48,
  muted: 0.64,
  subtle: 0.72,
  pressed: 0.88,
  opaque: 1,
  backdrop: 0.44
} as const;

export type OpacityToken = keyof typeof opacity;
