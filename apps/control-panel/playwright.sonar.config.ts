import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(appRoot, "../..");
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:4173";
const coverageOutput = path.join(root, "coverage/sonar/control-panel");
function controlPanelSourcePath(source: string): string {
  const normalized = source.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.startsWith("apps/control-panel/")) return normalized;
  if (/^(?:src|app)\//.test(normalized)) return `apps/control-panel/${normalized}`;
  return normalized;
}

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./playwright.global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  grepInvert: /@live/,
  reporter: [
    ["list"],
    ["monocart-reporter", {
      name: "Control Panel Sonar coverage",
      outputFile: path.join(coverageOutput, "playwright.html"),
      coverage: {
        outputDir: coverageOutput,
        reports: ["lcovonly"],
        sourcePath: controlPanelSourcePath,
        sourceFilter: (sourcePath: string) => {
          const normalized = controlPanelSourcePath(sourcePath);
          return /^apps\/control-panel\/(?:src|app)\/.+\.(?:ts|tsx)$/.test(normalized);
        },
      },
    }],
  ],
  use: {
    baseURL,
    locale: "ar-YE",
    trace: "retain-on-failure",
    browserName: "chromium",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname localhost --port 4173",
    cwd: appRoot,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      BTHWANI_SONAR_COVERAGE: "1",
    },
  },
});
