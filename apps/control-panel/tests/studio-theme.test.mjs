import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const { parseStudioPalette, parseStudioThemePublication, resolveStudioTheme, studioContrastRatio } =
  await import("../../../packages/design-system/src/theme/studio-palette.ts");
const { lightThemeColors, darkThemeColors } = await import("../../../packages/design-system/src/tokens/colors.ts");

const palette = Object.freeze({
  navy: "#102B4E", orange: "#F36B21", white: "#FFFFFF",
  turquoise: "#83DDF3", burgundy: "#7B1E3A",
});

test("public studio palette strictly rejects unknown fields, unsafe colors and invalid schema", () => {
  assert.deepEqual(parseStudioPalette(palette), palette);
  assert.equal(parseStudioPalette({ ...palette, unsafe: "#123456" }), null);
  assert.equal(parseStudioPalette({ ...palette, navy: "var(--danger)" }), null);
  assert.equal(parseStudioPalette({ ...palette, navy: "#FFFFFF" }), null);
  assert.equal(parseStudioPalette({ ...palette, white: "#000000" }), null);
  assert.equal(parseStudioPalette({ ...palette, turquoise: "#102B4E" }), null);
  assert.equal(parseStudioThemePublication({ schemaVersion: 2, templateKey: "CLIENT_HOME", version: 2, palette }), null);
  assert.equal(parseStudioThemePublication({ schemaVersion: 1, templateKey: "PARTNER", version: 2, palette }), null);
  assert.equal(parseStudioThemePublication({ schemaVersion: 1, templateKey: "CLIENT_HOME", version: 0, palette }), null);
  assert.equal(parseStudioThemePublication({ schemaVersion: 1, templateKey: "CLIENT_HOME", version: 1, palette: null }).palette, null);
  assert.equal(parseStudioThemePublication({ schemaVersion: 1, templateKey: "CLIENT_HOME", version: 2, palette }).palette.navy, "#102B4E");
});

test("published colors preserve semantic financial and status roles across day and night", () => {
  const custom = { ...palette, orange: "#EE772A", turquoise: "#7FE6E8" };
  for (const [name, defaults] of [["light", lightThemeColors], ["dark", darkThemeColors]]) {
    const theme = resolveStudioTheme(name, custom);
    assert.equal(theme.brandAction, "#EE772A");
    assert.equal(theme.brandTurquoise, custom.turquoise);
    assert.equal(theme.brandStructure, custom.navy);
    for (const role of ["success", "successText", "warning", "warningText", "danger", "dangerText", "info", "infoText", "disabledText"]) {
      assert.equal(theme[role], defaults[role], role + " must retain semantic meaning");
    }
    assert.ok(studioContrastRatio(theme.actionBackground, theme.onAction) >= 4.5, name + " primary button AA");
    assert.ok(studioContrastRatio(theme.actionText, theme.surface) >= 4.5, name + " interactive text AA");
    assert.ok(studioContrastRatio(theme.colorMuted, theme.surface) >= 4.5, name + " secondary text AA");
    assert.deepEqual(resolveStudioTheme(name, null), defaults);
    assert.deepEqual(resolveStudioTheme(name, { ...custom, navy: "#FFFFFF" }), defaults);
  }
  const borderline = { ...palette, navy: "#767676", turquoise: "#FFFFFF" };
  assert.ok(parseStudioPalette(borderline));
  const narrow = resolveStudioTheme("light", borderline);
  assert.equal(narrow.colorMuted, borderline.navy);
  assert.ok(studioContrastRatio(narrow.colorMuted, narrow.surface) >= 4.5);
  assert.notEqual(resolveStudioTheme("light", custom), lightThemeColors);
  assert.deepEqual(lightThemeColors, resolveStudioTheme("light", null));
});

test("theme publisher is operator-only and cannot use arbitrary CSS as a publication", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const route = readFileSync(path.join(root, "app/api/marketing/studio-theme/route.ts"), "utf8");
  const ui = readFileSync(path.join(root, "src/features/studio/published-theme-settings.tsx"), "utf8");
  assert.match(route, /verifySameOrigin\(request\)/);
  assert.match(route, /operatorWorkspacePermissionDenied\(identity, "marketing"\)/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /expectedVersion/);
  assert.match(ui, /parseStudioPalette\(shared\.document\.palette\)/);
  assert.match(ui, /ACTIVATE_DRAFT/);
  assert.match(ui, /RESTORE_DEFAULTS/);
  assert.match(ui, /ROLLBACK/);
  assert.match(ui, /window\.confirm/);
});
