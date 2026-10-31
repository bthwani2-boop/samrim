import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const {
  defaultStudioDraft, isStudioHex, moveStudioSection, parseStudioDraft, studioContrastRatio, studioPaletteWarnings,
} = await import("../src/features/studio/studio-draft.ts");

const nav = readFileSync(path.resolve(import.meta.dirname, "../src/navigation/workspace-registry.ts"), "utf8");
const route = readFileSync(path.resolve(import.meta.dirname, "../app/(workspace)/studio/page.tsx"), "utf8");
const editor = readFileSync(path.resolve(import.meta.dirname, "../src/features/studio/template-studio-workspace.tsx"), "utf8");

test("compiled five-color defaults are available without fetching Studio configuration", () => {
  const draft = defaultStudioDraft();
  assert.deepEqual(draft.palette, {
    navy: "#102B4E",
    orange: "#F36B21",
    white: "#FFFFFF",
    turquoise: "#83DDF3",
    burgundy: "#7B1E3A",
  });
  assert.equal(draft.schemaVersion, 1);
  assert.equal(draft.sections.length, 6);
  assert.deepEqual(studioPaletteWarnings(draft.palette), []);
  assert.equal(isStudioHex("javascript:alert(1)"), false);
  assert.equal(isStudioHex("#ABCDEF"), true);
});

test("local drafts validate schema, identity, length, roles and colors before restore", () => {
  const baseline = defaultStudioDraft();
  assert.deepEqual(parseStudioDraft(JSON.parse(JSON.stringify(baseline))), baseline);
  assert.equal(parseStudioDraft({ ...baseline, schemaVersion: 2 }), null);
  assert.equal(parseStudioDraft({ ...baseline, palette: { ...baseline.palette, navy: "var(--unsafe)" } }), null);
  assert.equal(parseStudioDraft({ ...baseline, sections: [...baseline.sections.slice(1), baseline.sections[1]] }), null);
  assert.equal(parseStudioDraft({ ...baseline, sections: baseline.sections.map((s) => ({ ...s, title: "x".repeat(81) })) }), null);
  assert.equal(parseStudioDraft({ ...baseline, slides: [] }), null);
  assert.equal(parseStudioDraft({ ...baseline, slides: [{ id: "slide-1", title: "<script>".repeat(20), description: "", buttonLabel: "" }] }), null);
  assert.equal(parseStudioDraft({ ...baseline, intervalSeconds: 1 }), null);
  assert.equal(parseStudioDraft({ ...baseline, palette: { ...baseline.palette, unsafe: "#ABABAB" } }), null);
});

test("reordering keeps each canonical section once and preserves its properties", () => {
  const sections = defaultStudioDraft().sections;
  const reordered = moveStudioSection(sections, "hero", "products");
  assert.deepEqual(reordered.map((s) => s.id), ["services", "stores", "products", "hero", "promotions", "trust"]);
  assert.equal(reordered.find((s) => s.id === "hero").title, sections[0].title);
  assert.deepEqual(sections.map((s) => s.id), ["hero", "services", "stores", "products", "promotions", "trust"]);
  assert.deepEqual(moveStudioSection(sections, "hero", "hero"), sections);
});

test("contrast control flags inaccessible user-defined text/surface combinations", () => {
  assert.ok(studioContrastRatio("#102B4E", "#FFFFFF") >= 4.5);
  assert.ok(studioContrastRatio("#FFFFFF", "#F36B21") < 4.5);
  assert.equal(studioContrastRatio("#000000", "#000000"), 1);
  assert.equal(studioContrastRatio("garbage", "#FFFFFF"), 0);
  assert.ok(studioPaletteWarnings({ ...defaultStudioDraft().palette, navy: "#FFFFFF" }).length >= 1);
});

test("Studio is an independent authorized destination, with no pretend publication", () => {
  assert.match(nav, /href: "\/studio", label: "استوديو التصميم", children: \[\], permission: "marketing"/);
  assert.match(route, /TemplateStudioWorkspace/);
  assert.match(editor, /state\.identity\.role !== "operator"/);
  assert.match(editor, /!state\.identity\.permissions\?\.includes\("marketing"\)/);
  assert.match(editor, /storagePrefix \+ actorId/);
  assert.match(editor, /النشر غير متاح/);
  assert.match(editor, /حفظ المسودة محليًا/);
  assert.match(editor, /"--studio-on-hero": draft\.palette\.white/);
});
