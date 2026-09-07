import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const { lightThemeColors, darkThemeColors } = await import("../../packages/design-system/src/tokens/colors.ts");

function themeToCssVariables(themeColors) {
  return {
    "--brand-action": themeColors.action,
    "--brand-action-hover": themeColors.actionHover,
    "--brand-action-pressed": themeColors.actionPressed,
    "--brand-action-soft": themeColors.actionSoft,
    "--brand-structure": themeColors.structure,
    "--brand-structure-soft": themeColors.structureSoft,
    "--surface-warm": themeColors.background,
    "--surface-base": themeColors.surface,
    "--surface-muted": themeColors.surfaceInset,
    "--surface-overlay": themeColors.surfaceOverlay,
    "--text-muted": themeColors.colorMuted,
    "--color-primary": themeColors.color,
    "--color-secondary": themeColors.colorSecondary,
    "--color-inverse": themeColors.colorInverse,
    "--color-on-action": themeColors.onAction ?? "#FFFFFF",
    "--border-subtle": themeColors.borderColor,
    "--border-strong": themeColors.borderColorStrong,
    "--focus-color": themeColors.focusColor,
    "--success": themeColors.success,
    "--success-soft": themeColors.successSoft,
    "--warning": themeColors.warning,
    "--warning-soft": themeColors.warningSoft,
    "--danger": themeColors.danger,
    "--danger-soft": themeColors.dangerSoft,
    "--info": themeColors.info,
    "--info-soft": themeColors.infoSoft,
    "--shadow-card": themeColors.shadowCard ?? (themeColors === lightThemeColors ? "0 22px 60px rgba(10, 47, 92, 0.1)" : "0 22px 60px rgba(0, 0, 0, 0.5)")
  };
}

function generateThemeCss() {
  const lightVars = Object.entries(themeToCssVariables(lightThemeColors))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  const darkVars = Object.entries(themeToCssVariables(darkThemeColors))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return `:root {
  color-scheme: light dark;
${lightVars}
}

@media (prefers-color-scheme: dark) {
  :root {
${darkVars}
  }
}

[data-theme="light"] {
  color-scheme: light;
${lightVars}
}

[data-theme="dark"] {
  color-scheme: dark;
${darkVars}
}
`;
}

const header = `/* Auto-generated from @bthwani/design-system. Do not edit manually. */\n`;
const cssContent = header + generateThemeCss();

const isCheck = process.argv.includes("--check");

const targetFiles = [
  path.join(repoRoot, "apps/control-panel/app/theme.css"),
  path.join(repoRoot, "packages/design-system/theme.css"),
];

if (isCheck) {
  for (const targetFile of targetFiles) {
    if (!fs.existsSync(targetFile)) {
      console.error(`Missing theme CSS: ${targetFile}`);
      process.exit(1);
    }
    const current = fs.readFileSync(targetFile, "utf8");
    if (current !== cssContent) {
      console.error(`Theme CSS drift detected: ${targetFile}`);
      process.exit(1);
    }
  }
  console.log("THEME_CSS_CHECK=PASS");
} else {
  for (const targetFile of targetFiles) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, cssContent, "utf8");
  }
  console.log("THEME_CSS_GENERATED=PASS");
}
