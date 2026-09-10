import { defineConfig } from "@playwright/test";

const DEFAULT_TEST_ORIGIN = "http://127.0.0.1:13001";
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const inheritedControlOrigin = process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
const baseURL = externalBaseURL || DEFAULT_TEST_ORIGIN;
const parsedBase = new URL(baseURL);

if (
  parsedBase.protocol !== "http:" ||
  parsedBase.hostname !== "127.0.0.1" ||
  parsedBase.pathname !== "/" ||
  parsedBase.search ||
  parsedBase.hash
) {
  throw new Error(
    `Control Panel Playwright base URL must be an HTTP IPv4-loopback origin, received: ${baseURL}`,
  );
}

if (
  !externalBaseURL &&
  inheritedControlOrigin &&
  inheritedControlOrigin.replace(/\/$/, "") !== parsedBase.origin
) {
  throw new Error(
    `Self-hosted Playwright origin drift: CONTROL_PANEL_PUBLIC_ORIGIN=${inheritedControlOrigin} baseURL=${parsedBase.origin}`,
  );
}

const testPort = parsedBase.port || "80";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: parsedBase.origin,
    locale: "ar-YE",
    trace: "retain-on-failure",
  },
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: `pnpm build && pnpm exec next start -H ${parsedBase.hostname} -p ${testPort}`,
          env: {
            BTHWANI_ENV: "development",
            CONTROL_PANEL_PUBLIC_ORIGIN: parsedBase.origin,
          },
          url: parsedBase.origin,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
