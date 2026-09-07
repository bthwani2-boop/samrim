import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const postgresPkg = path.join(root, "services/identity/backend/internal/storage/postgres");

console.log("==================================================");
console.log("VERIFYING MIGRATION V13 -> V15 UPGRADE, DATA PRESERVATION & SIX-DIGIT CUTOVER");
console.log("==================================================");

try {
  const output = execFileSync("go", ["test", "-v", "-run", "^TestMigrationV13ToV15Upgrade$", "."], {
    cwd: postgresPkg,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(output);
  if (output.includes("--- SKIP:") || !output.includes("--- PASS: TestMigrationV13ToV15Upgrade")) {
    console.error("MIGRATION_V13_TO_V15=FAIL (migration test was skipped or did not pass)");
    process.exit(1);
  }
  console.log("MIGRATION_V13_TO_V15=PASS");
  console.log("MIGRATION_DATA_PRESERVATION=PASS");
} catch (error) {
  console.error("MIGRATION_V13_TO_V15=FAIL");
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  process.exit(1);
}
