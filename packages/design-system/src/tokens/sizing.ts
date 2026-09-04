export const sizing = {
  controlXs: 32,
  controlSm: 36,
  controlMd: 44,
  controlLg: 52,
  controlXl: 60,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  iconXl: 32,
  avatarSm: 28,
  avatarMd: 40,
  avatarLg: 56,
  contentNarrow: 640,
  contentDefault: 960,
  contentWide: 1280
} as const;

export type SizingToken = keyof typeof sizing;
