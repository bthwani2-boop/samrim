// Enumerate authored Node tests once, then route each admitted file to its
// execution owner. Local developer-tool tests are not CI inputs.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const roots = ["apps", "services", "packages", "tests", "tools", "infra"];
const generated = new Set([
  "node_modules", ".git", ".nx", ".expo", ".next", ".next-dev",
  "coverage", "dist", "build", "graphify-out", ".cache", ".tmp", ".artifacts",
]);
const testCandidate = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;
const operatorRuntimeRoot = "apps/control-panel/tests/runtime/";
const localDeveloperTests = new Set(["tools/dev/graphify-local.test.mjs"]);

// Windows integration remains fail-closed while the required runtime suites
// are reconstructed. Shared source safety belongs to source-snapshot, not
// the Graphify index. Never silently drop a missing Windows obligation.
const windowsPlatformOwners = Object.freeze([
  "apps/customer/tests/customer-cart-docker-web.test.mjs",
  "tools/dev/Start-App-memory.test.mjs",
  "tools/dev/dev-powershell.test.mjs",
  "tools/dev/source-snapshot.test.mjs",
  "tools/dev/sync-lenovo-source.test.mjs",
]);

function relativeSource(root, file) {
  const name = relative(root, file);
  if (isAbsolute(name) || name === ".." || name.startsWith(".." + sep)) {
    throw new Error("SOURCE_SCOPE_OUTSIDE_CHECKOUT");
  }
  return name.replaceAll("\\", "/");
}

function discover(checkout, folders) {
  const root = resolve(checkout);
  const scopes = folders.map(folder => relativeSource(root, resolve(folder)));
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error("UNSCANNED_SOURCE_LINK .");
  if (!rootStat.isDirectory()) throw new Error("UNSCANNED_SOURCE_ENTRY .");
  const physicalRoot = realpathSync.native(root);
  const files = new Set();

  function inspect(file, optional = false) {
    const name = relativeSource(root, file);
    const stat = lstatSync(file, { throwIfNoEntry: !optional });
    if (!stat) return null;
    if (stat.isSymbolicLink() ||
        relative(join(physicalRoot, name), realpathSync.native(file)) !== "") {
      throw new Error("UNSCANNED_SOURCE_LINK " + (name || "."));
    }
    return stat;
  }

  function directory(file, optional = false) {
    const stat = inspect(file, optional);
    if (!stat) return false;
    if (!stat.isDirectory()) {
      throw new Error("UNSCANNED_SOURCE_ENTRY " + (relativeSource(root, file) || "."));
    }
    return true;
  }

  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      const name = relativeSource(root, file);
      if (generated.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) continue;
      if (entry.isSymbolicLink()) throw new Error("UNSCANNED_SOURCE_LINK " + name);
      if (entry.isDirectory()) {
        directory(file);
        walk(file);
        continue;
      }
      if (!testCandidate.test(entry.name)) continue;
      if (!entry.name.endsWith(".test.mjs")) {
        throw new Error("UNSUPPORTED_SOURCE_TEST_FORMAT " + name +
          " — configure its real runner before admitting this file");
      }
      if (!inspect(file).isFile()) throw new Error("UNSCANNED_SOURCE_ENTRY " + name);
      files.add(name);
    }
  }

  for (const scope of scopes) {
    let folder = root;
    let present = true;
    for (const part of scope.split("/").filter(Boolean)) {
      folder = join(folder, part);
      if (!directory(folder, true)) {
        present = false;
        break;
      }
    }
    if (present) walk(folder);
  }
  // Default JavaScript ordering is ordinal, not locale-dependent.
  return [...files].sort();
}

function partitionTests(files) {
  const suites = { source: [], operatorRuntime: [], localDeveloper: [] };
  for (const file of files) {
    if (localDeveloperTests.has(file)) suites.localDeveloper.push(file);
    else if (file.startsWith(operatorRuntimeRoot)) suites.operatorRuntime.push(file);
    else suites.source.push(file);
  }
  return suites;
}

export function discoverNodeSourceTests(root, folder) {
  return partitionTests(discover(root, [folder])).source;
}

export function discoverWorkspaceNodeTests(root) {
  return discover(root, roots.map(area => join(resolve(root), area)));
}

export function discoverWorkspaceTestSuites(root) {
  return partitionTests(discoverWorkspaceNodeTests(root));
}

export function discoverWindowsPlatformTests(root) {
  const source = new Set(discoverWorkspaceTestSuites(root).source);
  for (const file of windowsPlatformOwners) {
    if (!source.has(file)) throw new Error("WINDOWS_PLATFORM_TEST_MISSING " + file);
  }
  return [...windowsPlatformOwners];
}
