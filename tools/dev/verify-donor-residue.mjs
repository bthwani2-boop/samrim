import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((item) => item.replaceAll("\\", "/"));

const excluded = (file) =>
  file === ".github/workflows/baseline-guard.yml" ||
  file.startsWith("tools/prompting/bthwani-refoundation/");

const donorRepoName = "bthwani-suite" + "-next";
const patterns = [
  { label: "donor repository", value: "bthwani2-boop/" + donorRepoName },
  { label: "donor repository name", value: donorRepoName },
  { label: "donor Windows path", value: "D:\\" + donorRepoName },
  { label: "old secret path", value: "C:\\" + "bthwani-" + "secrets" },
  { label: "donor branch authority", value: ["origin", "h"].join("/") },
  { label: "donor ref pin", value: "RE_PIN_" + "h" },
  { label: "stale donor head marker", value: "UNKNOWN_CURRENT_" + "h" + "_HEAD" },
  {
    label: "obsolete completion token",
    value:
      "H_TRUSTWORTHY_CANONICAL_" +
      "BASELINE_REFOUNDATION_COMPLETE",
  },
];

const failures = [];

for (const file of tracked) {
  if (excluded(file)) continue;

  const absolute = path.join(repoRoot, file);
  const buffer = fs.readFileSync(absolute);

  if (buffer.includes(0)) continue;

  const lines = buffer.toString("utf8").split("\n");

  for (let index = 0; index < lines.length; index++) {
    for (const pattern of patterns) {
      if (lines[index].includes(pattern.value)) {
        failures.push(
          file +
            ":" +
            (index + 1) +
            " -> " +
            pattern.label,
        );
      }
    }
  }
}

if (failures.length) {
  console.error("DONOR_RESIDUE=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("DONOR_RESIDUE=0");
console.log("DONOR_RESIDUE_VERIFY=PASS");
