import { brandRoots } from "@bthwani/design-system";

export const studioSectionIds = ["hero", "services", "stores", "products", "promotions", "trust"] as const;
export type StudioSectionId = (typeof studioSectionIds)[number];
export type StudioPaletteKey = "navy" | "orange" | "white" | "turquoise" | "burgundy";
export type StudioViewport = "desktop" | "tablet" | "phone";
export type StudioAppearance = "light" | "dark";

export const studioPaletteNames: ReadonlyArray<Readonly<{ key: StudioPaletteKey; label: string }>> = [
  { key: "navy", label: "الكحلي الملكي" },
  { key: "orange", label: "البرتقالي الحيوي" },
  { key: "white", label: "الأبيض النقي" },
  { key: "turquoise", label: "الفيروزي الفاتح" },
  { key: "burgundy", label: "الكبدي" },
];

export type StudioPalette = Record<StudioPaletteKey, string>;
export type StudioSection = {
  id: StudioSectionId;
  visible: boolean;
  title: string;
  description: string;
  count: number;
};
export type StudioSlide = { id: string; title: string; description: string; buttonLabel: string };
export type StudioDraft = {
  schemaVersion: 1;
  sections: StudioSection[];
  palette: StudioPalette;
  slides: StudioSlide[];
  autoplay: boolean;
  intervalSeconds: number;
};
export const studioSectionLabels: Record<StudioSectionId, string> = {
  hero: "السلايدر الرئيسي",
  services: "شبكة الخدمات",
  stores: "المتاجر المميزة",
  products: "مختارات المتاجر",
  promotions: "العروض",
  trust: "كيف تعمل بثواني",
};
const sectionDefaults: StudioSection[] = [
  { id: "hero", visible: true, title: "بثواني نحقق الأماني", description: "كل ما تحتاجه من المتاجر القريبة", count: 2 },
  { id: "services", visible: true, title: "خدمات بثواني", description: "اختر الخدمة المناسبة", count: 4 },
  { id: "stores", visible: true, title: "متاجر قريبة منك", description: "استكشف المتاجر المتاحة", count: 4 },
  { id: "products", visible: true, title: "مختارات لك", description: "منتجات من متاجر بثواني", count: 4 },
  { id: "promotions", visible: true, title: "عروض اليوم", description: "العروض المتاحة لدى شركائنا", count: 2 },
  { id: "trust", visible: true, title: "كيف تعمل بثواني؟", description: "اختر، اطلب، وتابع التوصيل", count: 3 },
];

export function defaultStudioDraft(): StudioDraft {
  return {
    schemaVersion: 1,
    sections: sectionDefaults.map((value) => ({ ...value })),
    palette: {
      navy: brandRoots.brandStructure,
      orange: brandRoots.brandAction,
      white: brandRoots.surfaceBase,
      turquoise: brandRoots.brandTurquoise,
      burgundy: brandRoots.brandBurgundy,
    },
    slides: [
      { id: "slide-1", title: "بثواني نحقق الأماني", description: "طلباتك من المتاجر القريبة بخطوات واضحة", buttonLabel: "استكشف الخدمات" },
      { id: "slide-2", title: "اختر متجرك المفضل", description: "تسوق وتابع طلبك من مكان واحد", buttonLabel: "تصفح المتاجر" },
    ],
    autoplay: true,
    intervalSeconds: 5,
  };
}

const hex = /^#[0-9a-fA-F]{6}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function isStudioHex(value: string): boolean { return hex.test(value); }

export function parseStudioDraft(input: unknown): StudioDraft | null {
  if (!isRecord(input) || input.schemaVersion !== 1 || !Array.isArray(input.sections) || input.sections.length !== studioSectionIds.length || !isRecord(input.palette) || !Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > 4 || typeof input.autoplay !== "boolean" || !Number.isInteger(input.intervalSeconds) || Number(input.intervalSeconds) < 3 || Number(input.intervalSeconds) > 10) return null;
  const rawPalette = input.palette as Record<string, unknown>;
  const keys = Object.keys(rawPalette);
  if (keys.length !== studioPaletteNames.length || keys.some((key) => !studioPaletteNames.some((entry) => entry.key === key) || typeof rawPalette[key] !== "string" || !isStudioHex(rawPalette[key] as string))) return null;
  const sections: StudioSection[] = [];
  const seen = new Set<string>();
  for (const item of input.sections) {
    if (!isRecord(item) || typeof item.id !== "string" || !studioSectionIds.some((id) => id === item.id) || seen.has(item.id) || typeof item.visible !== "boolean" || typeof item.title !== "string" || item.title.length > 80 || typeof item.description !== "string" || item.description.length > 180 || !Number.isInteger(item.count) || Number(item.count) < 1 || Number(item.count) > 8) return null;
    seen.add(item.id);
    sections.push({ id: item.id as StudioSectionId, visible: item.visible, title: item.title, description: item.description, count: item.count as number });
  }
  if (sections.length !== studioSectionIds.length) return null;
  const slides: StudioSlide[] = [];
  const slideIds = new Set<string>();
  for (const item of input.slides) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^slide-[1-9][0-9]{0,4}$/.test(item.id) || slideIds.has(item.id) || typeof item.title !== "string" || item.title.length > 80 || typeof item.description !== "string" || item.description.length > 180 || typeof item.buttonLabel !== "string" || item.buttonLabel.length > 40) return null;
    slideIds.add(item.id);
    slides.push({ id: item.id, title: item.title, description: item.description, buttonLabel: item.buttonLabel });
  }
  const palette = input.palette as Record<StudioPaletteKey, string>;
  return { schemaVersion: 1, palette: { navy: palette.navy.toUpperCase(), orange: palette.orange.toUpperCase(), white: palette.white.toUpperCase(), turquoise: palette.turquoise.toUpperCase(), burgundy: palette.burgundy.toUpperCase() }, sections, slides, autoplay: input.autoplay, intervalSeconds: Number(input.intervalSeconds) };
}

export function moveStudioSection(sections: ReadonlyArray<StudioSection>, from: StudioSectionId, to: StudioSectionId): StudioSection[] {
  const source = sections.findIndex((value) => value.id === from);
  const target = sections.findIndex((value) => value.id === to);
  if (source < 0 || target < 0 || source === target) return [...sections];
  const next = [...sections];
  const [item] = next.splice(source, 1);
  if (!item) return [...sections];
  next.splice(target, 0, item);
  return next;
}

function luminance(hexColor: string): number {
  const rgb = [1, 3, 5].map((index) => {
    const part = Number.parseInt(hexColor.slice(index, index + 2), 16) / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}
export function studioContrastRatio(foreground: string, background: string): number {
  if (!isStudioHex(foreground) || !isStudioHex(background)) return 0;
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function studioPaletteWarnings(palette: StudioPalette): string[] {
  const pairs: ReadonlyArray<Readonly<{ foreground: string; background: string; label: string }>> = [
    { foreground: palette.navy, background: palette.white, label: "الكحلي على الأبيض" },
    { foreground: palette.white, background: palette.burgundy, label: "نص العرض الرئيسي على الكبدي" },
    { foreground: palette.navy, background: palette.turquoise, label: "الكحلي على الفيروزي" },
  ];
  return pairs.filter(({ foreground, background }) => studioContrastRatio(foreground, background) < 4.5)
    .map(({ label }) => `تباين ${label} أقل من 4.5:1 للنصوص الصغيرة.`);
}
