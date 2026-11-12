export const borders = {
  none: 0,
  hairline: 1,
  strong: 2
} as const;

export type BorderToken = keyof typeof borders;
