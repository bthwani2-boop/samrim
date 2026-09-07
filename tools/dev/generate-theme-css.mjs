import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const { generateThemeCss } = await import("../../packages/design-system/src/theme/index.ts");

const header = `/* Auto-generated from @bthwani/design-system. Do not edit manually. */\n`;
const cssContent = header + generateThemeCss();

const isCheck = process.argv.includes("--check");

const targetFile = path.join(repoRoot, "packages/design-system/theme.css");

if (isCheck) {
  if (!fs.existsSync(targetFile)) {
    console.error(`Missing theme CSS: ${targetFile}`);
    process.exit(1);
  }
  const current = fs.readFileSync(targetFile, "utf8");
  if (current !== cssContent) {
    console.error(`Theme CSS drift detected: ${targetFile}`);
    process.exit(1);
  }
  console.log("THEME_CSS_CHECK=PASS");
} else {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, cssContent, "utf8");
  console.log(`Wrote theme CSS to ${targetFile}`);
}
