import { alpha, darkThemeColors, lightThemeColors, type ThemeColors } from "../tokens/colors";

export type StudioPalette = Readonly<{
  navy: string;
  orange: string;
  white: string;
  turquoise: string;
  burgundy: string;
}>;

const keys = ["navy", "orange", "white", "turquoise", "burgundy"] as const;
const hex = /^#[A-Fa-f0-9]{6}$/;

function luminance(color: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function studioContrastRatio(foreground: string, background: string): number {
  if (!hex.test(foreground) || !hex.test(background)) return 0;
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function blend(first: string, second: string, toward: number): string {
  const mix = [1, 3, 5].map((offset) => {
    const a = Number.parseInt(first.slice(offset, offset + 2), 16);
    const b = Number.parseInt(second.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * toward).toString(16).padStart(2, "0");
  });
  return "#" + mix.join("").toUpperCase();
}

/** Never use vivid brand orange for white text until the action shade passes AA. */
function accessibleAction(brandOrange: string, text: string, toward: string): string {
  if (studioContrastRatio(brandOrange, text) >= 4.5) return brandOrange;
  for (let step = 1; step <= 100; step++) {
    const candidate = blend(brandOrange, toward, step / 100);
    if (studioContrastRatio(candidate, text) >= 4.5) return candidate;
  }
  return toward;
}

/** Strict published schema: no CSS, extra keys, incomplete values or unsafe text contrast. */
export function parseStudioPalette(value: unknown): StudioPalette | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length ||
      keys.some((key) => typeof record[key] !== "string" || !hex.test(record[key] as string))) return null;
  const palette = Object.fromEntries(keys.map((key) => [key, (record[key] as string).toUpperCase()])) as StudioPalette;
  if (luminance(palette.white) < 0.6 ||
      studioContrastRatio(palette.navy, palette.white) < 4.5 ||
      studioContrastRatio(palette.white, palette.burgundy) < 4.5 ||
      studioContrastRatio(palette.navy, palette.turquoise) < 4.5) return null;
  return palette;
}

export type StudioThemePublication = Readonly<{
  schemaVersion: 1;
  templateKey: "CLIENT_HOME";
  version: number;
  palette: StudioPalette | null;
}>;

export function parseStudioThemePublication(value: unknown): StudioThemePublication | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || item.templateKey !== "CLIENT_HOME" ||
      !Number.isSafeInteger(item.version) || Number(item.version) < 1) return null;
  if (item.palette === null) {
    return { schemaVersion: 1, templateKey: "CLIENT_HOME", version: Number(item.version), palette: null };
  }
  const palette = parseStudioPalette(item.palette);
  return palette ? { schemaVersion: 1, templateKey: "CLIENT_HOME", version: Number(item.version), palette } : null;
}

/**
 * A presentation-only projection onto the existing canonical semantic themes.
 * Financial/status colors, dark-surface text, focus geometry and compiled roots remain owned
 * by the core Design System. An invalid or absent publication falls back to compiled defaults.
 */
export function resolveStudioTheme(name: "light" | "dark", value: unknown): ThemeColors {
  const original = name === "dark" ? darkThemeColors : lightThemeColors;
  const palette = parseStudioPalette(value);
  if (!palette) return original;
  const dark = name === "dark";
  const action = accessibleAction(palette.orange, dark ? original.onAction : palette.white, dark ? "#FFFFFF" : "#000000");
  const pressed = accessibleAction(blend(action, dark ? "#FFFFFF" : "#000000", 0.26), dark ? original.onAction : palette.white, dark ? "#FFFFFF" : "#000000");
  const hover = accessibleAction(blend(action, dark ? "#FFFFFF" : "#000000", 0.13), dark ? original.onAction : palette.white, dark ? "#FFFFFF" : "#000000");
  const mutedCandidate = blend(palette.navy, palette.white, 0.16);
  const accessibleMuted = studioContrastRatio(mutedCandidate, palette.white) >= 4.5 ? mutedCandidate : palette.navy;
  return {
    ...original,
    brandAction: palette.orange,
    brandStructure: palette.navy,
    brandTurquoise: palette.turquoise,
    brandBurgundy: palette.burgundy,
    brandActionHover: hover,
    brandActionPressed: pressed,
    brandActionSoft: alpha(palette.orange, dark ? 0.18 : 0.1),
    actionBackground: action,
    actionHover: hover,
    actionPressed: pressed,
    actionSoft: alpha(palette.orange, dark ? 0.18 : 0.1),
    actionText: dark ? accessibleAction(palette.orange, original.surface, "#FFFFFF") : action,
    interactiveText: dark ? accessibleAction(palette.orange, original.surface, "#FFFFFF") : action,
    focusRing: dark ? accessibleAction(palette.orange, original.surface, "#FFFFFF") : action,
    ...(dark ? {} : {
      backgroundAlt: palette.white,
      surface: palette.white,
      surfaceOverlay: alpha(palette.white, 0.86),
      color: palette.navy,
      colorSecondary: palette.navy,
      colorMuted: accessibleMuted,
      colorInverse: palette.white,
      structure: palette.navy,
      structureSoft: alpha(palette.navy, 0.08),
      borderColor: alpha(palette.navy, 0.12),
      borderColorStrong: alpha(palette.navy, 0.22),
      onAction: palette.white,
    }),
  };
}
