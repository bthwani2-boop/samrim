// Single discovery boundary shared by project feedback and full source coverage.
// Only authored regular Node test files inside their checkout may enter the runner.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const roots = ["apps", "services", "packages", "tests", "tools", "infra"];
const generated = new Set([
  "node_modules", ".git", ".nx", ".expo", ".next", ".next-dev",
  "coverage", "dist", "build", "graphify-out", ".cache", ".tmp", ".artifacts",
]);
const candidate = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;

function relativeSource(root, file) {
  const rel = relative(root, file);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("SOURCE_SCOPE_OUTSIDE_CHECKOUT");
  }
  return rel.replaceAll("\\", "/");
}

function sourceScanner(checkout) {
  const root = resolve(checkout);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error("UNSCANNED_SOURCE_LINK .");
  if (!rootStat.isDirectory()) throw new Error("UNSCANNED_SOURCE_ENTRY .");
  const physical = realpathSync.native(root);

  function inspect(file, optional = false) {
    const name = relativeSource(root, file);
    const info = lstatSync(file, { throwIfNoEntry: !optional });
    if (!info) return null;
    if (info.isSymbolicLink()) throw new Error(`UNSCANNED_SOURCE_LINK ${name || "."}`);
    // Detect an ancestor redirect as well as an entry that was a direct link.
    const actual = realpathSync.native(file);
    if (relative(join(physical, name), actual) !== "") {
      throw new Error(`UNSCANNED_SOURCE_LINK ${name || "."}`);
    }
    return info;
  }

  function directory(file, optional = false) {
    const info = inspect(file, optional);
    if (!info) return false;
    if (!info.isDirectory()) throw new Error(`UNSCANNED_SOURCE_ENTRY ${relativeSource(root, file)}`);
    return true;
  }

  function scan(folder) {
    const target = resolve(folder);
    const scope = relativeSource(root, target);
    let parent = root;
    // A project-only invocation cannot skip validation of its parent source roots.
    for (const part of scope.split("/").filter(Boolean)) {
      parent = join(parent, part);
      if (!directory(parent, true)) return [];
    }

    const tests = [];
    function walk(dir) {
      directory(dir);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        const name = relativeSource(root, file);
        // Ignore only known generated directories and their dependency links.
        if (generated.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) continue;
        if (entry.isSymbolicLink()) throw new Error(`UNSCANNED_SOURCE_LINK ${name}`);
        if (entry.isDirectory()) {
          walk(file);
          continue;
        }
        if (!candidate.test(entry.name)) continue;
        if (!entry.name.endsWith(".test.mjs")) {
          throw new Error(`UNSUPPORTED_SOURCE_TEST_FORMAT ${name} — configure its real runner before admitting this file`);
        }
        if (!inspect(file).isFile()) throw new Error(`UNSCANNED_SOURCE_ENTRY ${name}`);
        tests.push(name);
      }
    }
    walk(target);
    return tests.sort();
  }
  return { root, scan };
}

// Runtime suites are owned by the presentation host that supplies their built
// artifact. All authored tests enter the same inventory before partitioning.
const operatorRuntimeRoot = "apps/control-panel/tests/runtime/";
function partitionTests(files) {
  const source = [];
  const operatorRuntime = [];
  for (const file of files) {
    (file.startsWith(operatorRuntimeRoot) ? operatorRuntime : source).push(file);
  }
  return { source, operatorRuntime };
}

export function discoverNodeSourceTests(root, folder) {
  // Reject a lexical escape before looking up either filesystem location.
  relativeSource(resolve(root), resolve(folder));
  return partitionTests(sourceScanner(root).scan(folder)).source;
}

export function discoverWorkspaceNodeTests(root) {
  const scanner = sourceScanner(root);
  return roots.flatMap(area => scanner.scan(join(scanner.root, area))).sort();
}

export function discoverWorkspaceTestSuites(root) {
  return partitionTests(discoverWorkspaceNodeTests(root));
}
