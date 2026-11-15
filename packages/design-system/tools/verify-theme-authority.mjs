import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const exists = rel => fs.existsSync(path.join(root, rel));
const violations = [];
const requireTrue = (condition, message) => { if (!condition) violations.push(message); };

const expectedPaths = [
  "packages/design-system/src/brand/colors.ts",
  "packages/design-system/src/semantics/themes.ts",
  "packages/design-system/src/web/css-projection.ts",
  "packages/tamagui-config/src/appearance.tsx",
];
for (const file of expectedPaths) requireTrue(exists(file), "Missing canonical owner: " + file);
const retiredPaths = [
  "packages/design-system/src/tokens",
  "packages/design-system/src/theme",
  "packages/design-system/src/native",
];
for (const retired of retiredPaths) requireTrue(!exists(retired), "Retired design authority reintroduced: " + retired);

const { brandRoots } = await import("../src/brand/colors.ts");
const { themes, lightThemeColors, darkThemeColors, themePreferences, isThemePreference, resolveThemeName } =
  await import("../src/semantics/themes.ts");
const { themeToCssVariables, generateThemeCss } = await import("../src/web/css-projection.ts");

const anchors = {
  brandAction: "#F36B21",
  brandStructure: "#102B4E",
  surfaceBase: "#FFFFFF",
  brandTurquoise: "#83DDF3",
  brandBurgundy: "#7B1E3A",
};
for (const [key, value] of Object.entries(anchors)) {
  requireTrue(brandRoots[key] === value, "Brand anchor drift: " + key);
}
const lightKeys = Object.keys(lightThemeColors).sort((a, b) => a.localeCompare(b, "en"));
requireTrue(JSON.stringify(lightKeys) === JSON.stringify(Object.keys(darkThemeColors).sort((a, b) => a.localeCompare(b, "en"))),
  "Light/Dark semantic role key mismatch");
requireTrue(themes.light === lightThemeColors && themes.dark === darkThemeColors,
  "Semantic themes must use one authored color source");
requireTrue(themePreferences.every(isThemePreference), "Theme preferences invalid");
requireTrue(resolveThemeName("system", "dark") === "dark" && resolveThemeName("system", "light") === "light",
  "System appearance must follow the platform");

const luminance = rgb => rgb.map(channel => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}).reduce((a, channel, index) => a + channel * [0.2126, 0.7152, 0.0722][index], 0);
function parseColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  throw new Error("Cannot measure unknown color: " + color);
}
function contrast(a, b) {
  const x = luminance(parseColor(a)), y = luminance(parseColor(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
for (const [name, t] of Object.entries(themes)) {
  for (const [role, background, minimum] of [
    ["color", "background", 4.5],
    ["color", "surface", 4.5],
    ["onAction", "actionBackground", 4.5],
    ["actionText", "background", 4.5],
    ["successText", name === "light" ? "successSoft" : "surface", 4.5],
    ["warningText", name === "light" ? "warningSoft" : "surface", 4.5],
    ["dangerText", name === "light" ? "dangerSoft" : "surface", 4.5],
    ["focusRing", "background", 3],
  ]) {
    requireTrue(contrast(t[role], t[background]) >= minimum,
      name + " contrast too low: " + role + " on " + background);
  }
}
const expectedCss = "/* Auto-generated from @bthwani/design-system. Do not edit manually. */\n" +
  generateThemeCss();
const css = read("packages/design-system/theme.css");
requireTrue(css === expectedCss, "Generated semantic CSS drifted from source");
for (const mode of ["light", "dark"]) {
  const vars = themeToCssVariables(themes[mode]);
  for (const [name, value] of Object.entries(vars)) {
    requireTrue(css.includes(name + ": " + value + ";"), mode + " CSS role missing: " + name);
  }
}
requireTrue(!/--(?:space|size|radius|duration|elevation|font-size|font-family|breakpoint|z)-/.test(css),
  "Renderer-owned numeric tokens must not be duplicated in shared CSS");

const panelLayout = read("apps/control-panel/app/layout.tsx");
const panelProvider = read("apps/control-panel/app/providers.tsx");
requireTrue(panelLayout.includes('import "@bthwani/design-system/theme.css"'),
  "Control panel must use only generated semantic CSS");
requireTrue(panelProvider.includes('direction="rtl"') && panelProvider.includes("locale={arEG}"),
  "Ant Design locale and RTL contract missing");
const rendererConfig = read("packages/tamagui-config/src/index.ts");
requireTrue(rendererConfig.includes('from "@bthwani/design-system/theme"'),
  "Tamagui must read the semantic source");
requireTrue(rendererConfig.includes('import { animations } from "./animations"') &&
  rendererConfig.includes("  animations,") &&
  exists("packages/tamagui-config/src/animations.web.ts") &&
  exists("packages/tamagui-config/src/animations.native.ts") &&
  exists("packages/tamagui-config/src/animations.ts"),
  "Tamagui needs one platform-specific official animation driver to support Dialog and Sheet");
requireTrue(!rendererConfig.includes("...defaultConfig.themes,"),
  "Do not expose preset color palettes as additional authored themes");
const appearance = read("packages/tamagui-config/src/appearance.tsx");
requireTrue(!appearance.includes("if (!ready) return null"),
  "Appearance restore must not hide SSR markup");
requireTrue(!appearance.includes('from "@expo/ui"'), "Do not create an Expo UI appearance engine");
for (const app of ["customer", "merchant", "captain"]) {
  const pkg = JSON.parse(read("apps/" + app + "/package.json"));
  requireTrue(pkg.dependencies["@bthwani/tamagui-config"] === "workspace:*",
    app + " must import its renderer");
  requireTrue(!pkg.dependencies["@bthwani/design-system"],
    app + " must not depend directly on the semantic owner");
  for (const f of ["_layout.tsx", "index.tsx", "health.tsx"]) {
    const s = read("apps/" + app + "/app/" + f);
    requireTrue(!s.includes("@bthwani/design-system/native/appearance"),
      app + " references retired native appearance owner: " + f);
  }
}
if (violations.length) {
  console.error("THEME_AUTHORITY_VERIFICATION=FAIL");
  violations.forEach(x => console.error(" - " + x));
  process.exitCode = 1;
} else {
  console.log("THEME_AUTHORITY_VERIFICATION=PASS");
  console.log("SINGLE_BRAND_SEMANTIC_SOURCE=PASS");
  console.log("TWO_RENDERER_TOKEN_OWNERS=PASS");
  console.log("GENERATED_CSS_PARITY=PASS");
  console.log("CHECKED_SEMANTIC_CONTRAST_PAIRS=PASS");
  console.log("VISUAL_ACCESSIBILITY_AND_NATIVE_FONTS=NOT_RUN");
}
