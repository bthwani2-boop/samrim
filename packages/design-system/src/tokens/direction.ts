export type Direction = "rtl" | "ltr";
export type LogicalAlignment = "start" | "center" | "end";

export const direction = {
  defaultDirection: "rtl" as Direction,
  defaultLanguage: "ar",
  rtlLanguages: ["ar", "fa", "he", "ur"],
  useLogicalProperties: true,
  mirrorDirectionalIcons: true
} as const;

export function isRtlLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return direction.rtlLanguages.some(
    (candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`)
  );
}

export function resolveDirection(language?: string, fallback: Direction = direction.defaultDirection): Direction {
  if (!language) return fallback;
  return isRtlLanguage(language) ? "rtl" : "ltr";
}

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

export function resolveRowDirection(direction: Direction): "row" | "row-reverse" {
  return direction === "rtl" ? "row-reverse" : "row";
}
