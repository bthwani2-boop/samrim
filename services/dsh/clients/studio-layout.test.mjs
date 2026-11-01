import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const { parseStudioLayoutPublication, publishedHomeSections, studioHomeSectionIds } =
  await import("./studio-layout.ts");

function publication() {
  return {
    schemaVersion: 1,
    templateKey: "CLIENT_HOME",
    version: 4,
    document: {
      schemaVersion: 2,
      sections: studioHomeSectionIds.map((id) => ({ id, visible: !["topSellers", "testimonials"].includes(id), title: id, description: "", count: 4 })),
      heroOptions: { height: "tall", align: "center", showDescription: true, showButton: true, showDots: false },
      palette: { navy: "#102B4E", orange: "#F36B21", white: "#FFFFFF", turquoise: "#83DDF3", burgundy: "#7B1E3A" },
      slides: [{ id: "slide-1", title: "بثواني", description: "", buttonLabel: "استكشف" }],
      autoplay: true,
      intervalSeconds: 5,
    },
  };
}

test("public layout accepts only versioned compatible complete Studio documents", () => {
  const input = publication();
  assert.equal(parseStudioLayoutPublication(input)?.version, 4);
  assert.equal(publishedHomeSections(parseStudioLayoutPublication(input)).length, 10);
  for (const changed of [
    { ...input, schemaVersion: 2 },
    { ...input, version: 0 },
    { ...input, draft: true },
    { ...input, document: { ...input.document, sections: [...input.document.sections, input.document.sections[0]] } },
    { ...input, document: { ...input.document, sections: input.document.sections.map((s, i) => i === 2 ? { ...s, id: "hero" } : s) } },
    { ...input, document: { ...input.document, slides: [] } },
    { ...input, document: { ...input.document, heroOptions: { ...input.document.heroOptions, height: "javascript:alert(1)" } } },
    { ...input, document: { ...input.document, palette: { ...input.document.palette, dangerous: "red" } } },
    { ...input, document: { ...input.document, sections: input.document.sections.map((s, i) => i === 0 ? { ...s, count: 100000 } : s) } },
  ]) assert.equal(parseStudioLayoutPublication(changed), null);
  assert.equal(parseStudioLayoutPublication({ schemaVersion: 1, templateKey: "CLIENT_HOME", version: 1, document: null })?.document, null);
  assert.equal(publishedHomeSections(parseStudioLayoutPublication({ schemaVersion: 1, templateKey: "CLIENT_HOME", version: 1, document: null })), null);
});

test("layout uses published order and visibility without inventing catalog records", () => {
  const input = publication();
  const reordered = [input.document.sections[5], ...input.document.sections.filter((s, i) => i !== 5)].map((s) => ({ ...s }));
  reordered[0].visible = true;
  reordered[1].visible = false;
  const parsed = parseStudioLayoutPublication({ ...input, document: { ...input.document, sections: reordered } });
  assert.equal(publishedHomeSections(parsed)[0].id, reordered[0].id);
  assert.ok(!publishedHomeSections(parsed).some((s) => s.id === reordered[1].id));
});
