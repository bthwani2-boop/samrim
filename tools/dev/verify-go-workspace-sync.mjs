import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "samrim-go-workspace-"));

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

function moduleFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (["node_modules", ".git", ".nx", ".next", "dist", "build", "coverage"].includes(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        const relative = path.relative(dir, absolute).replaceAll(path.sep, "/");
        if (relative === "go.work" || relative === "go.work.sum" || /(^|\/)go\.(mod|sum)$/.test(relative)) files.push(relative);
      }
    }
  };
  walk(dir);
  return files.sort();
}

try {
  for (const file of trackedFiles()) {
    const source = path.join(root, file);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const destination = path.join(tempRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  execFileSync("go", ["work", "sync"], { cwd: tempRoot, stdio: "inherit" });

  const before = moduleFiles(root);
  const after = moduleFiles(tempRoot);
  const all = [...new Set([...before, ...after])].sort();
  const drift = [];

  for (const file of all) {
    const source = path.join(root, file);
    const candidate = path.join(tempRoot, file);
    if (!fs.existsSync(source) || !fs.existsSync(candidate)) {
      drift.push(file + " existence changed");
      continue;
    }
    const a = fs.readFileSync(source);
    const b = fs.readFileSync(candidate);
    if (!a.equals(b)) drift.push(file);
  }

  if (drift.length) {
    console.error("GO_WORKSPACE_SYNC=FAIL");
    for (const file of drift) console.error("  " + file);
    process.exit(1);
  }

  console.log("GO_WORKSPACE_SYNC=PASS");
  console.log("GO_WORKSPACE_SYNC_MUTATED_REPOSITORY=0");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
