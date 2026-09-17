export type Direction = "rtl" | "ltr";
export type LogicalAlignment = "start" | "center" | "end";

export const direction = {
  defaultDirection: "rtl" as Direction,
  useLogicalProperties: true,
  mirrorDirectionalIcons: true
} as const;

/**
 * Resolve logical alignment for React Native Text nodes.
 * React Native Text resolves left/right with the node's writing direction;
 * therefore logical start/end retain the Text contract while TextInput uses
 * its own native alignment contract below.
 */
export function resolveTextAlign(value: "center", activeDirection: Direction): "center";
export function resolveTextAlign(value: "start", activeDirection: Direction): "left";
export function resolveTextAlign(value: "end", activeDirection: Direction): "right";
export function resolveTextAlign(value: LogicalAlignment, activeDirection: Direction): "left" | "center" | "right";
export function resolveTextAlign(value: LogicalAlignment, _activeDirection: Direction): "left" | "center" | "right" {
  if (value === "center") return "center";
  return value === "start" ? "left" : "right";
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

/** Resolve the complete logical text contract for Arabic-first native surfaces. */
export function resolveLogicalTextStyle(activeDirection: Direction) {
  return {
    textAlign: resolveTextAlign("start", activeDirection),
    writingDirection: activeDirection,
  } as const;
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
