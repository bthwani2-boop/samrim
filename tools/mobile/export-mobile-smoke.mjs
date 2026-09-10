import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("Usage: node export-mobile-smoke.mjs <app-name>");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps", app);
const distDir = path.join(appDir, "dist");

try {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  for (const platform of ["android", "ios"]) {
    execSync(`pnpm exec expo export --platform ${platform} --output-dir dist`, {
      cwd: appDir,
      stdio: "inherit",
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
    });

    if (!fs.existsSync(distDir)) {
      throw new Error(`Build failed: dist directory was not created for ${app} (${platform})`);
    }

    console.log(`MOBILE_EXPORT_SMOKE=PASS app=${app} platform=${platform} bytecode=default`);
    fs.rmSync(distDir, { recursive: true, force: true });
  }
} finally {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
}
