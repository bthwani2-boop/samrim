import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const inheritedControlOrigin = process.env.CONTROL_PANEL_PUBLIC_ORIGIN?.trim();
const baseURL = externalBaseURL || inheritedControlOrigin || "http://127.0.0.1:13000";
const parsedBase = new URL(baseURL);

if (
  parsedBase.protocol !== "http:" ||
  parsedBase.hostname !== "127.0.0.1" ||
  parsedBase.port === "" ||
  parsedBase.pathname !== "/" ||
  parsedBase.search ||
  parsedBase.hash
) {
  throw new Error(
    `Control Panel Playwright base URL must be an explicit HTTP IPv4-loopback origin, received: ${baseURL}`,
  );
}

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
});
