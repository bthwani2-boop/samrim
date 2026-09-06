import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("Usage: node build-mobile-app.mjs <app-name>");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps", app);
const distDir = path.join(appDir, "dist");

try {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  execSync("pnpm exec expo export --platform android --no-bytecode --output-dir dist", {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });

  if (!fs.existsSync(distDir)) {
    throw new Error(`Build failed: dist directory was not created for ${app}`);
  }

  console.log(`MOBILE_BUILD=PASS app=${app}`);
} finally {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
}
