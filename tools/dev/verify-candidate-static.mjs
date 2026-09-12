import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const checks = [
  ["Partner model", process.execPath, ["tools/dev/verify-partner-model.mjs"]],
  ["repository liveness", pnpm, ["run", "repository:verify-liveness"]],
  ["workspace verification", pnpm, ["run", "workspace:verify"]],
];

for (const [name, command, args] of checks) {
  console.log(`=== CANONICAL STATIC: ${name} ===`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: command === pnpm && process.platform === "win32" });
  if (result.error) {
    console.error(`CANDIDATE_STATIC=FAIL check=${name} error=${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`CANDIDATE_STATIC=FAIL check=${name} exit=${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }
}

console.log("CANDIDATE_STATIC=PASS");
