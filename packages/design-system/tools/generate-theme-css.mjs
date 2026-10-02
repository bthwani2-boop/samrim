import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const { generateThemeCss } = await import("../src/theme/index.ts");
const content = "/* Auto-generated from @bthwani/design-system. Do not edit manually. */\n" + generateThemeCss();
const target = path.join(packageRoot, "theme.css");

if (process.argv.includes("--check")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
    console.error("THEME_CSS_CHECK=FAIL");
    process.exit(1);
  }
  console.log("THEME_CSS_CHECK=PASS");
} else {
  fs.writeFileSync(target, content, "utf8");
  console.log(`Wrote ${target}`);
}
