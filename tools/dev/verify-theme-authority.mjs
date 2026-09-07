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

// 2. Parity check on light and dark keys
const { lightThemeColors, darkThemeColors } = await import("../../packages/design-system/src/tokens/colors.ts");
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

// 3. Check Control Panel globals.css and theme.css
const globalsCss = read("apps/control-panel/app/globals.css");
const themeCss = read("apps/control-panel/app/theme.css");

if (!globalsCss.includes('@import "./theme.css";')) {
  failures.push("apps/control-panel/app/globals.css must import generated ./theme.css");
}
if (globalsCss.includes("color-scheme: light;")) {
  failures.push("apps/control-panel/app/globals.css contains unjustified hardcoded color-scheme: light;");
}
if (globalsCss.includes("@media (prefers-color-scheme: dark)")) {
  failures.push("apps/control-panel/app/globals.css contains duplicated inline dark theme overrides; theme.css owns dark variables");
}
if (globalsCss.includes('[data-theme="dark"]')) {
  failures.push("apps/control-panel/app/globals.css contains duplicated data-theme dark overrides; theme.css owns dark variables");
}

// Verify theme.css is not empty and contains :root and prefers-color-scheme
if (!themeCss.includes(":root") || !themeCss.includes("@media (prefers-color-scheme: dark)")) {
  failures.push("apps/control-panel/app/theme.css missing canonical theme CSS structure");
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

// 4. Check Mobile apps for dynamic adaptive StatusBar
const mobileApps = ["app-client", "app-partner", "app-captain", "app-field"];
for (const app of mobileApps) {
  const layout = read(`apps/${app}/app/_layout.tsx`);
  if (/style=["'](?:dark|light)["']/.test(layout)) {
    failures.push(`apps/${app}/app/_layout.tsx has fixed StatusBar style instead of adaptive`);
  }
  if (!layout.includes("useColorScheme") && !layout.includes("style=\"auto\"")) {
    failures.push(`apps/${app}/app/_layout.tsx is not theme-adaptive`);
  }
}

// 5. Check app-client identity-gate and ManagedIdentityFlow for local color authorities
const clientGate = read("apps/app-client/src/identity-gate.tsx");
if (clientGate.includes("colorRoles.") || clientGate.includes("statusScale.")) {
  failures.push("apps/app-client/src/identity-gate.tsx retains obsolete static colorRoles or statusScale");
}

const managedFlow = read("services/identity/clients/presentation/ManagedIdentityFlow.tsx");
if (managedFlow.includes("colorRoles.") || managedFlow.includes("statusScale.")) {
  failures.push("ManagedIdentityFlow retains obsolete static colorRoles or statusScale");
}

if (failures.length > 0) {
  console.error("THEME_AUTHORITY_VERIFICATION=FAIL");
  for (const f of failures) {
    console.error(` - ${f}`);
  }
  process.exit(1);
}

console.log("DESIGN_SYSTEM_SINGLE_THEME_AUTHORITY=PASS");
console.log("LOCAL_SEMANTIC_COLOR_AUTHORITY=0");
console.log("DUPLICATE_LIGHT_DARK_TRUTH=0");
console.log("DEAD_THEME_TOKEN=0");
console.log("STATUS_BAR_THEME_SYNC=PASS");
console.log("CONTROL_PANEL_RAW_SEMANTIC_COLORS=0");
console.log("THEME_KEYS_PARITY=PASS");
