import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error("GO_FORMAT_CHECK=FAIL invalid project root");
  process.exit(1);
}

const files = [];
const ignored = new Set([".git", "node_modules", "vendor", "dist", "build", "coverage"]);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".go")) files.push(full);
  }
}
walk(root);

const unformatted = [];
for (let i = 0; i < files.length; i += 100) {
  const output = execFileSync("gofmt", ["-l", ...files.slice(i, i + 100)], { encoding: "utf8" });
  unformatted.push(...output.split(/\r?\n/).filter(Boolean));
}
if (unformatted.length) {
  console.error("GO_FORMAT_CHECK=FAIL");
  for (const file of unformatted) console.error(file);
  process.exit(1);
}
console.log(`GO_FORMAT_CHECK=PASS files=${files.length}`);
