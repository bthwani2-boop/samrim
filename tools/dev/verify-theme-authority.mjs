import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const failures = [];

function read(relPath) {
  const full = path.join(repoRoot, relPath);
  if (!fs.existsSync(full)) {
    failures.push(`Missing file: ${relPath}`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

// Contrast ratio utilities (WCAG 2.2)
function parseRgb(colorStr) {
  if (!colorStr) return [0, 0, 0];
  const rgbaMatch = colorStr.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbaMatch) {
    return [Number.parseInt(rgbaMatch[1], 10), Number.parseInt(rgbaMatch[2], 10), Number.parseInt(rgbaMatch[3], 10)];
  }
  const hex = colorStr.replace("#", "");
  const expanded =
    hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex.slice(0, 6);
  if (expanded.length !== 6) return [0, 0, 0];
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16)
  ];
}

function relativeLuminance(colorStr) {
  const [r, g, b] = parseRgb(colorStr).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(colorA, colorB) {
  const l1 = relativeLuminance(colorA);
  const l2 = relativeLuminance(colorB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// 1. Check packages/design-system theme authority
const colorsTs = read("packages/design-system/src/tokens/colors.ts");
const themeIndexTs = read("packages/design-system/src/theme/index.ts");

if (!colorsTs.includes("export const lightThemeColors =")) {
  failures.push("packages/design-system/src/tokens/colors.ts missing lightThemeColors");
}
if (!colorsTs.includes("export const darkThemeColors =")) {
  failures.push("packages/design-system/src/tokens/colors.ts missing darkThemeColors");
}
if (colorsTs.includes("tamaguiColorTokens")) {
  failures.push("packages/design-system retains dead tamaguiColorTokens");
}
if (colorsTs.includes("colorPalette")) {
  failures.push("packages/design-system retains dead colorPalette");
}

if (!themeIndexTs.includes("export function resolveTheme")) {
  failures.push("packages/design-system/src/theme/index.ts missing resolveTheme");
}
if (!themeIndexTs.includes("export function generateThemeCss")) {
  failures.push("packages/design-system/src/theme/index.ts missing generateThemeCss");
}
if (!themeIndexTs.includes("export function themeToCssVariables")) {
  failures.push("packages/design-system/src/theme/index.ts missing themeToCssVariables");
}
if (!themeIndexTs.includes("export function webFoundationToCssVariables")) {
  failures.push("packages/design-system/src/theme/index.ts missing webFoundationToCssVariables");
}

// 2. Parity check on light and dark keys
const { lightThemeColors, darkThemeColors } = await import("../../packages/design-system/src/tokens/colors.ts");
const { generateThemeCss, isThemePreference, resolveThemeName, themePreferences, webFoundationToCssVariables } = await import("../../packages/design-system/src/theme/index.ts");
const { toAsciiDigits } = await import("../../packages/design-system/src/tokens/formatting.ts");

if (toAsciiDigits("١٢٣٤٥٦٧٨٩٠ ۱۲۳۴۵۶۷۸۹۰") !== "1234567890 1234567890") {
  failures.push("Design System ASCII digit normalization is incomplete");
}
const lightKeys = Object.keys(lightThemeColors).sort();
const darkKeys = Object.keys(darkThemeColors).sort();

const missingInDark = lightKeys.filter((k) => !(k in darkThemeColors));
const missingInLight = darkKeys.filter((k) => !(k in lightThemeColors));

if (missingInDark.length > 0) {
  failures.push(`darkThemeColors missing keys: ${missingInDark.join(", ")}`);
}
if (missingInLight.length > 0) {
  failures.push(`lightThemeColors missing keys: ${missingInLight.join(", ")}`);
}

// 3. Contrast Matrix Verification (WCAG 2.2 AA)
// Normal text requires >= 4.5:1. Focus / UI components require >= 3:1.
function checkContrast(themeName, roleName, fgColor, bgRole, bgColor, minRatio) {
  const ratio = contrastRatio(fgColor, bgColor);
  if (ratio < minRatio) {
    failures.push(
      `Contrast failure in ${themeName}: ${roleName} (${fgColor}) on ${bgRole} (${bgColor}) is ${ratio.toFixed(2)}:1 (required >= ${minRatio}:1)`
    );
  }
}

// Light theme checks
checkContrast("light", "onAction", lightThemeColors.onAction, "actionBackground", lightThemeColors.actionBackground, 4.5);
checkContrast("light", "actionText", lightThemeColors.actionText, "background", lightThemeColors.background, 4.5);
checkContrast("light", "actionText", lightThemeColors.actionText, "surface", lightThemeColors.surface, 4.5);
checkContrast("light", "focusRing", lightThemeColors.focusRing, "background", lightThemeColors.background, 3.0);
checkContrast("light", "focusRing", lightThemeColors.focusRing, "surface", lightThemeColors.surface, 3.0);
checkContrast("light", "color", lightThemeColors.color, "background", lightThemeColors.background, 4.5);
checkContrast("light", "color", lightThemeColors.color, "surface", lightThemeColors.surface, 4.5);
checkContrast("light", "structure", lightThemeColors.structure, "background", lightThemeColors.background, 4.5);
checkContrast("light", "onAction", lightThemeColors.onAction, "structure", lightThemeColors.structure, 4.5);
checkContrast("light", "successText", lightThemeColors.successText, "successSoft", lightThemeColors.successSoft, 4.5);
checkContrast("light", "warningText", lightThemeColors.warningText, "warningSoft", lightThemeColors.warningSoft, 4.5);
checkContrast("light", "dangerText", lightThemeColors.dangerText, "dangerSoft", lightThemeColors.dangerSoft, 4.5);
checkContrast("light", "infoText", lightThemeColors.infoText, "infoSoft", lightThemeColors.infoSoft, 4.5);

// Dark theme checks
checkContrast("dark", "onAction", darkThemeColors.onAction, "actionBackground", darkThemeColors.actionBackground, 4.5);
checkContrast("dark", "actionText", darkThemeColors.actionText, "background", darkThemeColors.background, 4.5);
checkContrast("dark", "actionText", darkThemeColors.actionText, "surface", darkThemeColors.surface, 4.5);
checkContrast("dark", "focusRing", darkThemeColors.focusRing, "background", darkThemeColors.background, 3.0);
checkContrast("dark", "focusRing", darkThemeColors.focusRing, "surface", darkThemeColors.surface, 3.0);
checkContrast("dark", "color", darkThemeColors.color, "background", darkThemeColors.background, 4.5);
checkContrast("dark", "color", darkThemeColors.color, "surface", darkThemeColors.surface, 4.5);
checkContrast("dark", "structure", darkThemeColors.structure, "background", darkThemeColors.background, 4.5);
checkContrast("dark", "onAction", darkThemeColors.onAction, "structure", darkThemeColors.structure, 4.5);
checkContrast("dark", "successText", darkThemeColors.successText, "surface", darkThemeColors.surface, 4.5);
checkContrast("dark", "warningText", darkThemeColors.warningText, "surface", darkThemeColors.surface, 4.5);
checkContrast("dark", "dangerText", darkThemeColors.dangerText, "surface", darkThemeColors.surface, 4.5);
checkContrast("dark", "infoText", darkThemeColors.infoText, "surface", darkThemeColors.surface, 4.5);

// 4. Check Single Canonical Theme CSS Artifact & No Drift
const dsThemeCss = read("packages/design-system/theme.css");
const expectedHeader = `/* Auto-generated from @bthwani/design-system. Do not edit manually. */\n`;
const expectedCss = expectedHeader + generateThemeCss();

for (const [name, value] of Object.entries(webFoundationToCssVariables())) {
  if (!dsThemeCss.includes(`${name}: ${value};`)) {
    failures.push(`theme.css is missing canonical web token ${name}`);
  }
}

if (dsThemeCss !== expectedCss) {
  failures.push("packages/design-system/theme.css has drifted from canonical generateThemeCss()");
}
if (!themePreferences.every((preference) => isThemePreference(preference))) {
  failures.push("Design System theme preference contract is incomplete");
}
if (resolveThemeName("system", "dark") !== "dark" || resolveThemeName("system", "light") !== "light") {
  failures.push("Design System system theme resolution does not follow the platform scheme");
}

// Verify no duplicate editable theme.css in control-panel
if (fs.existsSync(path.join(repoRoot, "apps/control-panel/app/theme.css"))) {
  failures.push("apps/control-panel/app/theme.css exists as duplicate artifact; control panel must import @bthwani/design-system/theme.css");
}

// 5. Check Control Panel globals.css
const globalsCss = read("apps/control-panel/app/globals.css");

if (!globalsCss.includes('@import "@bthwani/design-system/theme.css";')) {
  failures.push('apps/control-panel/app/globals.css must import "@bthwani/design-system/theme.css"');
}
if (globalsCss.includes("color-scheme: light;")) {
  failures.push("apps/control-panel/app/globals.css contains unjustified hardcoded color-scheme: light;");
}
if (globalsCss.includes("@media (prefers-color-scheme: dark)")) {
  failures.push("apps/control-panel/app/globals.css contains duplicated inline dark theme overrides; theme.css owns dark variables");
}
if (globalsCss.includes('[data-theme="dark"]') || globalsCss.includes('[data-theme="light"]')) {
  failures.push("apps/control-panel/app/globals.css contains dead data-theme manual branch");
}
if (!dsThemeCss.includes(':root[data-theme="light"]') || !dsThemeCss.includes(':root[data-theme="dark"]')) {
  failures.push("packages/design-system/theme.css is missing canonical explicit theme preference overrides");
}

// Verify no raw hex or rgb colors in control-panel globals.css
const hexOrRgbRegex = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;
const globalsCssMatches = globalsCss.match(hexOrRgbRegex);
if (globalsCssMatches) {
  failures.push(`apps/control-panel/app/globals.css contains raw color literals: ${globalsCssMatches.join(", ")}`);
}

// Check control-panel page.tsx for inline visualTokens override
const controlPanelPage = read("apps/control-panel/app/page.tsx");
if (controlPanelPage.includes("visualTokens") || controlPanelPage.includes("style={visualTokens}")) {
  failures.push("apps/control-panel/app/page.tsx contains visualTokens overriding CSS variables");
}

// 6. Check Mobile apps for dynamic adaptive StatusBar
const mobileApps = ["app-client", "app-partner", "app-captain", "app-field"];
for (const app of mobileApps) {
  const layout = read(`apps/${app}/app/_layout.tsx`);
  if (/style=["'](?:dark|light)["']/.test(layout)) {
    failures.push(`apps/${app}/app/_layout.tsx has fixed StatusBar style instead of adaptive`);
  }
  if (!layout.includes("AppearanceProvider")) {
    failures.push(`apps/${app}/app/_layout.tsx is not theme-adaptive`);
  }
}

// 7. Check app-client identity-gate and ManagedIdentityFlow for local color authorities
const clientGate = read("apps/app-client/src/features/access/identity-gate.tsx");
if (clientGate.includes("colorRoles.") || clientGate.includes("statusScale.")) {
  failures.push("apps/app-client/src/features/access/identity-gate.tsx retains obsolete static colorRoles or statusScale");
}

const managedFlow = read("services/identity/clients/presentation/ManagedIdentityFlow.tsx");
if (managedFlow.includes("colorRoles.") || managedFlow.includes("statusScale.")) {
  failures.push("ManagedIdentityFlow retains obsolete static colorRoles or statusScale");
}

const clientIdentityPresentation = read("apps/app-client/src/features/access/identity-presentation.ts");
if (clientIdentityPresentation.includes("direction:")) {
  failures.push("app-client identity presentation retains a local direction authority");
}

for (const [name, body] of [
  ["app-client identity gate", clientGate],
  ["ManagedIdentityFlow", managedFlow],
  ["theme tokens", colorsTs],
  ["theme CSS generator", themeIndexTs],
  ["control-panel globals", globalsCss],
]) {
  if (/\btheme\.(action|focusColor)\b/.test(body) || /\b(action|focusColor):\s*brandScale/.test(body) || body.includes("--focus-color") || body.includes("var(--focus-color)")) {
    failures.push(`${name} retains retired action/focus semantic aliases`);
  }
}

if (failures.length > 0) {
  console.error("THEME_AUTHORITY_VERIFICATION=FAIL");
  for (const f of failures) {
    console.error(` - ${f}`);
  }
  process.exit(1);
}

console.log("DESIGN_SYSTEM_SINGLE_THEME_AUTHORITY=PASS");
console.log("SCOPED_LOCAL_SEMANTIC_COLOR_AUTHORITY=0");
console.log("SCOPED_DUPLICATE_LIGHT_DARK_TRUTH=0");
console.log("DEAD_THEME_TOKEN=0");
console.log("STATUS_BAR_THEME_SYNC=PASS");
console.log("CONTROL_PANEL_RAW_SEMANTIC_COLORS=0");
console.log("THEME_KEYS_PARITY=PASS");
console.log("STATIC_THEME_TOKEN_CONTRAST_MATRIX=PASS");
console.log("UNJUSTIFIED_DUPLICATE_THEME_CSS=0");
console.log("DEAD_MANUAL_THEME_BRANCH=0");
