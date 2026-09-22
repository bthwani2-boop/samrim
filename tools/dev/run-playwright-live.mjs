import { spawnSync } from "node:child_process";

const destructiveProofAuthorized = process.env.CI === "true" && process.env.BTHWANI_IDENTITY_PROOF_SCOPE === "disposable-ci";
if (!destructiveProofAuthorized) {
  console.error("IDENTITY_PROOF_REFUSED scope=developer-state reason=disposable-ci-required");
  process.exit(1);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  pnpm,
  ["exec", "playwright", "test", "--config", "playwright.config.ts", ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: { ...process.env, PLAYWRIGHT_LIVE_IDENTITY: "1" },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) {
  console.error(`PLAYWRIGHT_LIVE_RUNNER=FAIL ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
