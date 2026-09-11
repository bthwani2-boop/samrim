import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const inheritedControlOrigin = process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
const baseURL = externalBaseURL || inheritedControlOrigin;
const liveIdentityProof = process.env.PLAYWRIGHT_LIVE_IDENTITY === "1";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./playwright.global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  ...(liveIdentityProof ? { grep: /@live/ } : { grepInvert: /@live/ }),
  reporter: "list",
  use: {
    ...(baseURL ? { baseURL } : {}),
    locale: "ar-YE",
    trace: "retain-on-failure",
  },
});
