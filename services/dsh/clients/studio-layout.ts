import type { StudioDraftDocument, StudioLayoutPublication } from "./generated/dsh-types";

export const studioHomeSectionIds = [
  "hero", "benefits", "services", "stores", "products", "curated",
  "banners", "topSellers", "promotions", "testimonials", "brands", "trust",
] as const;

export type StudioHomeSectionId = (typeof studioHomeSectionIds)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function exactly(input: Record<string, unknown>, fields: ReadonlyArray<string>) {
  return Object.keys(input).length === fields.length && fields.every((key) => Object.hasOwn(input, key));
}

const sectionSet = new Set<string>(studioHomeSectionIds);
const hex = /^#[0-9A-Fa-f]{6}$/;

/** Reject unknown versions, partial documents and unsafe/unbounded publication data. */
export function parseStudioLayoutPublication(input: unknown): StudioLayoutPublication | null {
  if (!isRecord(input) || !Number.isSafeInteger(input.version) || Number(input.version) < 1 ||
      input.schemaVersion !== 1 || input.templateKey !== "CLIENT_HOME" ||
      !["document", "schemaVersion", "templateKey", "version"].every((key) => Object.hasOwn(input, key)) ||
      Object.keys(input).some((key) => !["document", "schemaVersion", "templateKey", "version", "publishedByActorId"].includes(key)) ||
      (input.publishedByActorId !== undefined && typeof input.publishedByActorId !== "string")) return null;

  if (input.document === null) return input as StudioLayoutPublication;
  const doc = input.document;
  if (!isRecord(doc) || !exactly(doc, ["schemaVersion", "sections", "heroOptions", "palette", "slides", "autoplay", "intervalSeconds"]) ||
      doc.schemaVersion !== 2 || !Array.isArray(doc.sections) || doc.sections.length !== studioHomeSectionIds.length ||
      !Array.isArray(doc.slides) || doc.slides.length < 1 || doc.slides.length > 4 ||
      typeof doc.autoplay !== "boolean" || !Number.isInteger(doc.intervalSeconds) || Number(doc.intervalSeconds) < 3 || Number(doc.intervalSeconds) > 10) return null;

  const ids = new Set<string>();
  for (const item of doc.sections) {
    if (!isRecord(item) || !exactly(item, ["id", "visible", "title", "description", "count"]) ||
        typeof item.id !== "string" || !sectionSet.has(item.id) || ids.has(item.id) ||
        typeof item.visible !== "boolean" || typeof item.title !== "string" || [...item.title].length > 80 ||
        typeof item.description !== "string" || [...item.description].length > 180 ||
        !Number.isInteger(item.count) || Number(item.count) < 1 || Number(item.count) > 8) return null;
    ids.add(item.id);
  }

  const hero = doc.heroOptions;
  if (!isRecord(hero) || !exactly(hero, ["height", "align", "showDescription", "showButton", "showDots"]) ||
      !["compact", "regular", "tall"].includes(String(hero.height)) ||
      !["start", "center", "end"].includes(String(hero.align)) ||
      ["showDescription", "showButton", "showDots"].some((key) => typeof hero[key] !== "boolean")) return null;

  const palette = doc.palette;
  if (!isRecord(palette) || !exactly(palette, ["navy", "orange", "white", "turquoise", "burgundy"]) ||
      Object.values(palette).some((value) => typeof value !== "string" || !hex.test(value))) return null;

  const slideIds = new Set<string>();
  for (const item of doc.slides) {
    if (!isRecord(item) || !exactly(item, ["id", "title", "description", "buttonLabel"]) ||
        typeof item.id !== "string" || !/^slide-[1-9][0-9]{0,4}$/.test(item.id) || slideIds.has(item.id) ||
        typeof item.title !== "string" || [...item.title].length > 80 ||
        typeof item.description !== "string" || [...item.description].length > 180 ||
        typeof item.buttonLabel !== "string" || [...item.buttonLabel].length > 40) return null;
    slideIds.add(item.id);
  }
  return input as StudioLayoutPublication;
}

export function publishedHomeSections(publication: StudioLayoutPublication | null): ReadonlyArray<StudioDraftDocument["sections"][number]> | null {
  if (!publication?.document) return null;
  return publication.document.sections.filter((section) => section.visible);
}
