import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const { parseStudioThemePublication, resolveStudioTheme, themeToCssVariables } =
  await import("../../../packages/design-system/src/theme/index.ts");
const { lightThemeColors, darkThemeColors } =
  await import("../../../packages/design-system/src/tokens/colors.ts");

const operator = path.resolve(import.meta.dirname, "..");
const publicRoute = readFileSync(path.join(operator, "app/api/appearance/studio-theme/route.ts"), "utf8");
const provider = readFileSync(path.join(operator, "src/shell/ant-design-provider.tsx"), "utf8");

const palette = {
  navy: "#102B4E", orange: "#EE772A", white: "#FFFFFF",
  turquoise: "#7FE6E8", burgundy: "#7B1E3A",
};

test("public operator palette is read only, published-only, no-store and not marketing-role gated", () => {
  assert.match(publicRoute, /GET\(\)/);
  assert.match(publicRoute, /\/dsh\/public\/studio-theme/);
  assert.match(publicRoute, /parseStudioThemePublication\(result\.payload\)/);
  assert.match(publicRoute, /Cache-Control.*no-store/);
  assert.doesNotMatch(publicRoute, /studio-draft|readOperatorSession|operatorWorkspacePermissionDenied|PUT\(/);
  assert.match(provider, /fetch\("\/api\/appearance\/studio-theme"/);
  assert.match(provider, /resolveStudioTheme\(mode, palette\)/);
  assert.match(provider, /themeToCssVariables\(colors\)/);
  assert.match(provider, /root\.style\.removeProperty/);
});

test("operator semantic CSS and Ant theme share safe published colors by appearance", () => {
  const publication = parseStudioThemePublication({
    schemaVersion: 1, templateKey: "CLIENT_HOME", version: 4, palette,
  });
  assert.ok(publication);
  for (const [mode, defaults] of [["light", lightThemeColors], ["dark", darkThemeColors]]) {
    const colors = resolveStudioTheme(mode, publication.palette);
    const variables = themeToCssVariables(colors);
    assert.equal(variables["--action-bg"], colors.actionBackground);
    assert.equal(variables["--color-primary"], colors.color);
    assert.equal(variables["--interactive-text"], colors.interactiveText);
    assert.equal(variables["--success"], defaults.success);
    assert.equal(variables["--danger"], defaults.danger);
    assert.equal(variables["--warning"], defaults.warning);
    assert.deepEqual(resolveStudioTheme(mode, null), defaults);
    assert.deepEqual(resolveStudioTheme(mode, { ...palette, navy: "#FFFFFF" }), defaults);
  }
  assert.equal(parseStudioThemePublication({
    schemaVersion: 100, templateKey: "CLIENT_HOME", version: 4, palette,
  }), null);
});
