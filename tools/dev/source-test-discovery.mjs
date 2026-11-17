// Feature/journey tests must be executed or explicitly rejected, never ignored.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const testCandidate = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
// Generated dependency and build trees are never workspace test sources.
const ignoredDirectories = new Set(["node_modules", ".git", ".nx", ".expo", ".next", ".next-dev",
  "coverage", "dist", "build", "graphify-out", ".cache", ".tmp", ".artifacts"]);


export function discoverNodeSourceTests(root, folder) {
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const name = relative(root, full).replaceAll("\\", "/");
        if (entry.name.endsWith(".test.mjs")) files.push(name);
        else if (testCandidate.test(entry.name)) {
          throw new Error("UNSUPPORTED_SOURCE_TEST_FORMAT " + name +
            " — configure its real runner before admitting this file");
        }
      }
    }
  }
  walk(folder);
  return files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}


// Discover all actual workspace Node tests, including new untracked tooling,
// infrastructure and future Feature/package tests. Other formats fail closed.
export function discoverWorkspaceNodeTests(root) {
  return [...new Set(["apps", "services", "packages", "tests", "tools", "infra"]
    .flatMap((dir) => discoverNodeSourceTests(root, join(root, dir))))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
