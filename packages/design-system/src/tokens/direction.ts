export type Direction = "rtl" | "ltr";
export type LogicalAlignment = "start" | "center" | "end";

export const direction = {
  defaultDirection: "rtl" as Direction,
  useLogicalProperties: true,
  mirrorDirectionalIcons: true
} as const;

/**
 * Resolve logical alignment for React Native Text nodes.
 * `textAlign` is a physical left/right value on Android, so the mapping
 * must follow the active layout direction. `writingDirection` is iOS-only
 * and cannot be the source of alignment truth on Android.
 */
export function resolveTextAlign(value: "center", activeDirection: Direction): "center";
export function resolveTextAlign(value: "start", activeDirection: "rtl"): "right";
export function resolveTextAlign(value: "start", activeDirection: "ltr"): "left";
export function resolveTextAlign(value: "end", activeDirection: "rtl"): "left";
export function resolveTextAlign(value: "end", activeDirection: "ltr"): "right";
export function resolveTextAlign(value: LogicalAlignment, activeDirection: Direction): "left" | "center" | "right";
export function resolveTextAlign(value: LogicalAlignment, activeDirection: Direction): "left" | "center" | "right" {
  if (value === "center") return "center";
  if (value === "start") return activeDirection === "rtl" ? "right" : "left";
  return activeDirection === "rtl" ? "left" : "right";
}

/** Resolve logical alignment for React Native TextInput nodes. */
export function resolveTextInputAlign(value: "center", activeDirection: Direction): "center";
export function resolveTextInputAlign(value: "start", activeDirection: "rtl"): "right";
export function resolveTextInputAlign(value: "start", activeDirection: "ltr"): "left";
export function resolveTextInputAlign(value: "end", activeDirection: "rtl"): "left";
export function resolveTextInputAlign(value: "end", activeDirection: "ltr"): "right";
export function resolveTextInputAlign(value: LogicalAlignment, activeDirection: Direction): "left" | "center" | "right";
export function resolveTextInputAlign(value: LogicalAlignment, activeDirection: Direction): "left" | "center" | "right" {
  if (value === "center") return "center";
  if (value === "start") return activeDirection === "rtl" ? "right" : "left";
  return activeDirection === "rtl" ? "left" : "right";
}

export function resolveRowDirection(direction: Direction): "row" | "row-reverse" {
  return direction === "rtl" ? "row-reverse" : "row";
}

/** Convert Arabic-Indic and Eastern Arabic-Indic numerals to the product's ASCII digit form. */
export function toAsciiDigits(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0x660 && codePoint <= 0x669) return String(codePoint - 0x660);
    if (codePoint >= 0x6f0 && codePoint <= 0x6f9) return String(codePoint - 0x6f0);
    return character;
  }).join("");
}
