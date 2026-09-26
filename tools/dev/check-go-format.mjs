import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const requested = process.argv[2];

if (!requested) {
  console.error("GO_FORMAT_CHECK=FAIL missing project root");
  process.exit(1);
}

const targetRoot = path.resolve(repoRoot, requested);
const relative = path.relative(repoRoot, targetRoot);
if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
  console.error("GO_FORMAT_CHECK=FAIL project root must be inside repository");
  process.exit(1);
}
if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
  console.error("GO_FORMAT_CHECK=FAIL project root does not exist: " + requested);
  process.exit(1);
}

const ignored = new Set([".git", "node_modules", "vendor", "dist", "build", "coverage"]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".go")) files.push(full);
  }
}

walk(targetRoot);

const unformatted = [];
for (let index = 0; index < files.length; index += 100) {
  const chunk = files.slice(index, index + 100);
  if (chunk.length === 0) continue;
  const output = execFileSync("gofmt", ["-l", ...chunk], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  unformatted.push(
    ...output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

if (unformatted.length > 0) {
  console.error("GO_FORMAT_CHECK=FAIL root=" + requested);
  for (const file of unformatted) {
    console.error("  " + path.relative(repoRoot, file).replaceAll(path.sep, "/"));
  }
  process.exit(1);
}

console.log("GO_FORMAT_CHECK=PASS root=" + requested + " files=" + files.length);
