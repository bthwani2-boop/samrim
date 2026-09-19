import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const inheritedControlOrigin = process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
const baseURL = externalBaseURL || inheritedControlOrigin;

if (!baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL or CONTROL_PANEL_PUBLIC_ORIGIN is required");
}

const liveIdentityProof = process.env.PLAYWRIGHT_LIVE_IDENTITY === "1";
const controlSessionStatePath = path.join(
  process.env.BTHWANI_SECRETS_ROOT?.trim() || "C:\\BTHWANI-Secrets\\samrim",
  "control-playwright",
  "storage-state.json",
);
const reusableControlSession = !liveIdentityProof && existsSync(controlSessionStatePath) ? controlSessionStatePath : undefined;
const configuredExpectTimeout = Number.parseInt(process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? "", 10);
const expectTimeout = Number.isFinite(configuredExpectTimeout) && configuredExpectTimeout > 0 ? configuredExpectTimeout : 5_000;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./playwright.global-setup.ts",
  timeout: 30_000,
  expect: { timeout: expectTimeout },
  fullyParallel: true,
  ...(liveIdentityProof ? { grep: /@live/ } : { grepInvert: /@live/ }),
  reporter: "list",
  use: {
    baseURL,
    locale: "ar-YE",
    trace: reusableControlSession ? "off" : "retain-on-failure",
    ...(reusableControlSession ? { storageState: reusableControlSession } : {}),
  },
});
