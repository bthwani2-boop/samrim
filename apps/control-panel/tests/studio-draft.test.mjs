import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const {
  defaultStudioDraft, isStudioHex, moveStudioSection, parseStudioDraft,
  studioContrastRatio, studioPaletteWarnings, studioSectionIds,
} = await import("../src/features/studio/studio-draft.ts");
const nav = readFileSync(path.resolve(import.meta.dirname, "../src/navigation/workspace-registry.ts"), "utf8");
const route = readFileSync(path.resolve(import.meta.dirname, "../app/(workspace)/studio/page.tsx"), "utf8");
const editor = readFileSync(path.resolve(import.meta.dirname, "../src/features/studio/template-studio-workspace.tsx"), "utf8");

test("the approved five colors and twelve preview section roles are compiled defaults", () => {
  const draft = defaultStudioDraft();
  assert.deepEqual(draft.palette, {
    navy: "#102B4E", orange: "#F36B21", white: "#FFFFFF",
    turquoise: "#83DDF3", burgundy: "#7B1E3A",
  });
  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.sections.length, 12);
  assert.deepEqual(draft.sections.map((s) => s.id), studioSectionIds);
  assert.equal(draft.sections.filter((s) => s.visible).length, 6);
  assert.deepEqual(studioPaletteWarnings(draft.palette), []);
  assert.equal(isStudioHex("javascript:alert(1)"), false);
  assert.equal(isStudioHex("#ABCDEF"), true);
});

test("draft schema validates each section once, colors, lengths, hero settings, and slides", () => {
  const baseline = defaultStudioDraft();
  assert.deepEqual(parseStudioDraft(JSON.parse(JSON.stringify(baseline))), baseline);
  assert.equal(parseStudioDraft({ ...baseline, schemaVersion: 3 }), null);
  assert.equal(parseStudioDraft({ ...baseline, palette: { ...baseline.palette, navy: "var(--unsafe)" } }), null);
  assert.equal(parseStudioDraft({ ...baseline, sections: [...baseline.sections.slice(1), baseline.sections[1]] }), null);
  assert.equal(parseStudioDraft({ ...baseline, sections: baseline.sections.map((s) => ({ ...s, title: "x".repeat(81) })) }), null);
  assert.equal(parseStudioDraft({ ...baseline, slides: [] }), null);
  assert.equal(parseStudioDraft({ ...baseline, slides: [{ id: "slide-1", title: "<script>".repeat(20), description: "", buttonLabel: "" }] }), null);
  assert.equal(parseStudioDraft({ ...baseline, intervalSeconds: 1 }), null);
  assert.equal(parseStudioDraft({ ...baseline, palette: { ...baseline.palette, unsafe: "#ABABAB" } }), null);
  assert.equal(parseStudioDraft({ ...baseline, heroOptions: { ...baseline.heroOptions, height: "1800px" } }), null);
  assert.equal(parseStudioDraft({ ...baseline, heroOptions: { ...baseline.heroOptions, showDots: "false" } }), null);
});

test("legacy six-section private drafts migrate without losing edited content or changing visibility", () => {
  const baseline = defaultStudioDraft();
  const oldIds = ["hero", "services", "stores", "products", "promotions", "trust"];
  const oldSections = baseline.sections.filter((section) => oldIds.includes(section.id));
  oldSections[0] = { ...oldSections[0], title: "عنواني السابق", visible: false };
  const { heroOptions: _ignored, ...old } = baseline;
  const legacy = { ...old, schemaVersion: 1, sections: oldSections };
  const migrated = parseStudioDraft(legacy);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.sections.length, 12);
  assert.equal(migrated.sections[0].title, "عنواني السابق");
  assert.equal(migrated.sections[0].visible, false);
  assert.deepEqual(migrated.sections.slice(0, 6).map((s) => s.id), oldIds);
  assert.ok(migrated.sections.slice(6).every((section) => !section.visible));
  assert.equal(parseStudioDraft({ ...legacy, sections: [...oldSections, oldSections[0]] }), null);
  assert.deepEqual(parseStudioDraft(migrated), migrated);
});

test("reordering keeps each approved section exactly once and does not mutate input", () => {
  const sections = defaultStudioDraft().sections;
  const reordered = moveStudioSection(sections, "hero", "products");
  assert.deepEqual(reordered.map((s) => s.id).slice(0, 6), ["benefits", "services", "stores", "products", "hero", "curated"]);
  assert.equal(reordered.find((s) => s.id === "hero").title, sections[0].title);
  assert.deepEqual(sections.map((s) => s.id), studioSectionIds);
  assert.deepEqual(moveStudioSection(sections, "hero", "hero"), sections);
});

test("contrast diagnostics detect unsafe semantic text and surface combinations", () => {
  assert.ok(studioContrastRatio("#102B4E", "#FFFFFF") >= 4.5);
  assert.ok(studioContrastRatio("#FFFFFF", "#F36B21") < 4.5);
  assert.equal(studioContrastRatio("#000000", "#000000"), 1);
  assert.equal(studioContrastRatio("garbage", "#FFFFFF"), 0);
  assert.ok(studioPaletteWarnings({ ...defaultStudioDraft().palette, navy: "#FFFFFF" }).length >= 1);
});

test("studio is independently authorized and reuses the canonical DSH banner owner", () => {
  assert.match(nav, /href: "\/studio", label: "استوديو التصميم", children: \[\], permission: "marketing"/);
  assert.match(route, /TemplateStudioWorkspace/);
  assert.match(editor, /state\.identity\.role !== "operator"/);
  assert.match(editor, /!state\.identity\.permissions\?\.includes\("marketing"\)/);
  assert.match(editor, /storagePrefix \+ actorId/);
  assert.match(editor, /PublishedThemeSettings shared=\{shared\}/);
  assert.match(editor, /نشر ألوان التطبيقات/);
  assert.match(editor, /حفظ المسودة محليًا/);
  assert.match(editor, /PublishedBannerSettings/);
  const published = readFileSync(path.resolve(import.meta.dirname, "../src/features/studio/published-banner-settings.tsx"), "utf8");
  assert.match(published, /MarketingBannerPresentation images=\{images\}/);
  assert.match(published, /\/api\/marketing\/content\?kind=BANNER&state=PUBLISHED/);
  assert.match(editor, /"--studio-on-hero": draft\.palette\.white/);
  assert.match(editor, /prefers-reduced-motion/);
});
