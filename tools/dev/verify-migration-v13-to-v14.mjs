import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const postgresPkg = path.join(root, "services/identity/backend/internal/storage/postgres");

console.log("==================================================");
console.log("VERIFYING MIGRATION V13 -> V14 UPGRADE & DATA PRESERVATION");
console.log("==================================================");

try {
  const output = execFileSync("go", ["test", "-v", "-run", "TestMigrationV13ToV14Upgrade", "."], {
    cwd: postgresPkg,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(output);
  console.log("MIGRATION_V13_TO_V14=PASS");
  console.log("MIGRATION_DATA_PRESERVATION=PASS");
} catch (error) {
  console.error("MIGRATION_V13_TO_V14=FAIL");
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  process.exit(1);
}
