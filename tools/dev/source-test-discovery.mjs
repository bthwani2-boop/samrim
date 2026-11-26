// Discover authored Node tests once per requested scope; reject unadmitted
// paths and unsupported test formats before partitioning for native runners.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const roots = ["apps", "services", "packages", "tests", "tools", "infra"];
const generated = new Set([
  "node_modules", ".git", ".nx", ".expo", ".next", ".next-dev",
  "coverage", "dist", "build", "graphify-out", ".cache", ".tmp", ".artifacts",
]);
const testCandidate = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;
const operatorRuntimeRoot = "apps/control-panel/tests/runtime/";
const windowsPlatformOwners = Object.freeze([
  "apps/customer/tests/customer-cart-docker-web.test.mjs",
  "tools/dev/Start-App-memory.test.mjs",
  "tools/dev/dev-powershell.test.mjs",
  "tools/dev/graphify-local.test.mjs",
  "tools/dev/sync-lenovo-source.test.mjs",
]);

// Ordinal order is independent of locale and filesystem enumeration order.
const comparePaths = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function relativeSource(root, file) {
  const rel = relative(root, file);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) {
    throw new Error("SOURCE_SCOPE_OUTSIDE_CHECKOUT");
  }
  return rel.replaceAll("\\", "/");
}

function discover(checkout, folders) {
  const root = resolve(checkout);
  // Check lexical scope before any filesystem access.
  const scopes = folders.map(folder => relativeSource(root, resolve(folder)));
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error("UNSCANNED_SOURCE_LINK .");
  if (!rootStat.isDirectory()) throw new Error("UNSCANNED_SOURCE_ENTRY .");
  const physicalRoot = realpathSync.native(root);
  const files = [];

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
      } else if (testCandidate.test(entry.name)) {
        if (!entry.name.endsWith(".test.mjs")) {
          throw new Error("UNSUPPORTED_SOURCE_TEST_FORMAT " + name +
            " — configure its real runner before admitting this file");
        }
        if (!inspect(file).isFile()) throw new Error("UNSCANNED_SOURCE_ENTRY " + name);
        files.push(name);
      }
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
  return files.sort(comparePaths);
}

function partitionTests(files) {
  const source = [];
  const operatorRuntime = [];
  for (const file of files) {
    (file.startsWith(operatorRuntimeRoot) ? operatorRuntime : source).push(file);
  }
  return { source, operatorRuntime };
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

// These suites exercise native Windows semantics in addition to portable
// source coverage; their registered owner paths must actually exist.
export function discoverWindowsPlatformTests(root) {
  const source = new Set(discoverWorkspaceTestSuites(root).source);
  for (const file of windowsPlatformOwners) {
    if (!source.has(file)) throw new Error("WINDOWS_PLATFORM_TEST_MISSING " + file);
  }
  return [...windowsPlatformOwners];
}
