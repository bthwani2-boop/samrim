import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function verifyLocalSpeedContract(root = path.resolve(import.meta.dirname, "../..")) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const json = (relative) => JSON.parse(read(relative));
  const failures = [];
  const checks = [];

  function check(condition, message) {
    checks.push(message);
    if (!condition) failures.push(message);
  }

  function absent(source, patterns, label) {
    for (const pattern of patterns) {
      check(!pattern.test(source), `${label} must not contain ${pattern}`);
    }
  }

  const pkg = json("package.json");
  const dev = read("tools/dev/dev.ps1");
  const localCheck = read("tools/dev/check-local.ps1");
  const finalVerify = read("tools/dev/verify-local-candidate.ps1");
  const safePush = read("tools/dev/safe-push.ps1");
  const surface = read("tools/dev/start-surface.mjs");

  const expectedScripts = {
    check: "pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/check-local.ps1",
    "speed:check": "node tools/dev/verify-local-speed-contract.mjs",
    client: "pnpm --dir apps/app-client dev",
    partner: "pnpm --dir apps/app-partner dev",
    captain: "pnpm --dir apps/app-captain dev",
    field: "pnpm --dir apps/app-field dev",
    control: "pnpm --dir apps/control-panel dev",
  };
  for (const [name, command] of Object.entries(expectedScripts)) {
    check(pkg.scripts?.[name] === command, `package script ${name} must route through its owning app package`);
  }

  check(localCheck.includes("$env:NX_NO_CLOUD = 'true'"), "inner-loop check must keep Nx Cloud disabled");
  check(localCheck.includes("pnpm exec nx affected"), "inner-loop check must remain Nx affected-driven");
  check(localCheck.includes("--files="), "inner-loop check must scope from exact working-tree files");
  check(localCheck.includes("--nxBail=true"), "inner-loop check must stop at the first material failure");
  check(localCheck.includes("--parallel=2"), "inner-loop check must keep bounded local parallelism");
  check(localCheck.includes("powershell-syntax runtime-ownership agent-contract cache-contracts"), "inner-loop check must run affected local contracts");
  absent(localCheck, [
    /\bnx\s+run-many\b/i,
    /\bdocker(?:\.exe)?\b/i,
    /run-playwright/i,
    /\bsonar\b/i,
    /--skip-nx-cache/i,
    /\bpnpm\s+(?:dev\s+(?:up|down|status)|scr)\b/i,
  ], "inner-loop check");
  check(!/targets\s*=\s*['"][^'"]*\bbuild\b/i.test(localCheck), "inner-loop targets must not include build");
  check(!/targets\s*=\s*['"][^'"]*export-smoke/i.test(localCheck), "inner-loop targets must not include export-smoke");

  check(surface.includes('args=[cli,"start","--dev-client","--localhost","--port",port]'), "mobile surface must start Expo directly");
  check(surface.includes('args=[cli,"dev","-H","127.0.0.1","-p",port]'), "Control surface must start Next directly");
  check(surface.includes("process.argv[2]"), "root surface launcher must accept one explicit canonical app name");
  absent(surface, [
    /pnpm\s+exec\s+nx/i,
    /docker\s+compose/i,
    /run-playwright/i,
    /\bsonar\b/i,
    /\btsc\b/i,
    /\bbiome\b/i,
  ], "surface launcher");

  check(dev.includes("docker compose --ansi never --project-name samrim-local"), "runtime owner must delegate state to the canonical Compose project");
  check(dev.includes("--build") && dev.includes("--wait"), "runtime startup must use Compose build cache and native health readiness");
  check(dev.includes("Compose @('down', '--remove-orphans')"), "runtime shutdown must delegate service ownership to Compose");
  absent(dev, [
    /backend-input-state\.json/,
    /Get-PathFingerprint/,
    /Read-RunningBackendImages/,
    /Test-BackendImageStateEqual/,
  ], "local runtime owner");
  absent(dev, [
    /Get-ChildItem[^\r\n]*-Recurse/i,
    /nx\s+(?:affected|run-many|run)\b/i,
    /run-playwright/i,
    /\bsonar\b/i,
  ], "local runtime owner");

  check(finalVerify.includes("$env:NX_NO_CLOUD = 'true'"), "final local verification must not depend on Nx Cloud");
  check(finalVerify.includes("powershell-syntax runtime-ownership agent-contract cache-contracts"), "final verification must run affected local contracts");
  check(!/NX_DAEMON\s*=\s*['"]false['"]/i.test(finalVerify), "final local verification must not disable the local Nx daemon");
  check(safePush.includes("verify-local-candidate.ps1"), "safe push must keep final verification at push closure");
  const mainFetch = safePush.indexOf("Invoke-Git @('fetch','--no-tags','origin','main')");
  const remoteBranchFallback = safePush.indexOf("} else {");
  check(mainFetch > remoteBranchFallback, "safe push must fetch main only when the target branch is absent");
  check(!safePush.includes("pnpm verify"), "safe push must not duplicate final verification through a second wrapper");
  return { checks, failures: [...new Set(failures)].sort((left, right) => left.localeCompare(right, "en")) };
}

export function localSpeedContractReport(result) {
  if (result.failures.length > 0) {
    return {
      exitCode: 1,
      lines: ["LOCAL_SPEED_CONTRACT=FAIL", ...result.failures.map((failure) => `  ${failure}`)],
    };
  }
  return {
    exitCode: 0,
    lines: [
      `LOCAL_SPEED_CONTRACT=PASS checks=${result.checks.length}`,
      "INNER_LOOP=working-tree-files->nx-affected->local-cache->first-failure",
      "SURFACE_LOOP=direct-expo-or-next+hmr-no-proof",
      "RUNTIME=compose-build-cache+health-readiness",
      "REMOTE_DEPENDENCY_IN_LOCAL_LOOP=0",
      "FINAL_PROOF=verify-or-safe-push-only",
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyLocalSpeedContract();
  const report = localSpeedContractReport(result);
  for (const line of report.lines) console.log(line);
  process.exitCode = report.exitCode;
}
