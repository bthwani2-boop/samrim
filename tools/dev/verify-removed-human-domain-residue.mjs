import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const forbidden = ["work", "force"].join("").toLowerCase();
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((item) => item.replaceAll("\\", "/"));

const failures = [];

for (const file of tracked) {
  if (file.toLowerCase().includes(forbidden)) {
    failures.push("FORBIDDEN_REMOVED_DOMAIN_PATH: " + file);
  }

  const absolute = path.join(repoRoot, file);
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;

  const content = buffer.toString("utf8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].toLowerCase().includes(forbidden)) {
      failures.push(
        "FORBIDDEN_REMOVED_DOMAIN_CONTENT: " +
          file +
          ":" +
          (index + 1) +
          ": " +
          lines[index].trim(),
      );
    }
  }
}

if (failures.length > 0) {
  console.error("REMOVED_HUMAN_DOMAIN_RESIDUE=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("REMOVED_HUMAN_DOMAIN_PATHS=0");
console.log("REMOVED_HUMAN_DOMAIN_CONTENT_MATCHES=0");
console.log("REMOVED_HUMAN_DOMAIN_RESIDUE=PASS");
