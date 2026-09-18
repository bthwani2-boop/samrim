import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((value) => value.replaceAll("\\", "/"))
  .filter((value) => fs.existsSync(path.join(root, value)));
const set = new Set(tracked);
const failures = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};
const json = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
    return null;
  }
};
const children = (base) =>
  [...new Set(
    tracked
      .filter((value) => value.startsWith(`${base}/`))
      .map((value) => value.slice(base.length + 1))
      .filter((value) => value.includes("/"))
      .map((value) => value.split("/", 1)[0]),
  )].sort();

function project(base, name, tag) {
  const file = `${base}/${name}/project.json`;
  assert(set.has(file), `${file} missing`);
  if (!set.has(file)) return null;
  const value = json(file);
  if (!value) return null;
  assert(value.root === `${base}/${name}`, `${file} root mismatch`);
  assert(value.name === name, `${file} name mismatch`);
  assert(Array.isArray(value.tags) && value.tags.includes(tag), `${file} missing ${tag}`);
  return value;
}

const structurePath = "REPOSITORY-STRUCTURE.md";
assert(set.has(structurePath), `${structurePath} missing`);
if (set.has(structurePath)) {
  const structure = fs.readFileSync(path.join(root, structurePath), "utf8");
  for (const token of [
    "ARTIFACT_CLASS: REPOSITORY_LOCAL_PLACEMENT_CONTRACT",
    "PLACEMENT_CONTRACT_AUTHORITY: DELEGATED_BY_AGENTS_MD",
    "PRODUCT_SEMANTIC_AUTHORITY: NONE",
    "DURABLE_ARCHITECTURE_AUTHORITY: NONE",
    "CURRENT_IMPLEMENTATION_INVENTORY_AUTHORITY: NONE",
    "Current app/service/package members are discovered from the exact project graph/source",
    "This is a placement grammar, not current inventory",
  ]) {
    assert(structure.includes(token), `${structurePath} missing placement-only invariant: ${token}`);
  }
}

const allowedTopLevel = new Set([".github", "apps", "contracts", "infra", "packages", "services", "tools"]);
const topLevel = [...new Set(
  tracked.filter((value) => value.includes("/")).map((value) => value.split("/", 1)[0]),
)].sort();
for (const item of topLevel) {
  assert(allowedTopLevel.has(item), `Unadmitted top-level ownership class tracked: ${item}`);
}
for (const required of [".github", "tools"]) {
  assert(topLevel.includes(required), `Required repository/tool root missing: ${required}`);
}

assert(set.has("knowledge.sources.json"), "knowledge.sources.json missing");
const retiredKnowledgeManifest = ["governance", "lock", "json"].join(".");
assert(!set.has(retiredKnowledgeManifest), `retired ${retiredKnowledgeManifest} remains tracked`);

for (const forbidden of ["core/", "shared/", "common/"]) {
  assert(!tracked.some((value) => value.startsWith(forbidden)), `Forbidden top-level ownership class: ${forbidden}`);
}

const locks = tracked.filter((value) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(value));
assert(
  locks.length === 1 && locks[0] === "pnpm-lock.yaml",
  `Canonical package lock must be pnpm-lock.yaml; found ${locks.join(",")}`,
);

const apps = children("apps");
for (const app of apps) {
  const value = project("apps", app, "type:app");
  if (!value) continue;
  const base = `apps/${app}/`;
  assert(value.projectType === "application", `${base} projectType must be application`);
  for (const file of ["README.md", "package.json"]) {
    assert(set.has(base + file), `${base}${file} missing`);
  }

  assert(!tracked.some((item) => item.startsWith(base + "runtime/")), `${app} pass-through runtime ownership is forbidden`);
  for (const bucket of ["shared", "common", "utils", "helpers"]) {
    assert(
      !tracked.some((item) => item.startsWith(`${base}src/${bucket}/`)),
      `${app} generic src/${bucket} ownership is forbidden`,
    );
  }

  const expo = set.has(base + "mobile.config.json") || set.has(base + "app.config.ts");
  const next = ["next.config.ts", "next.config.js", "next.config.mjs"].some((file) => set.has(base + file));
  const rootRouter = tracked.some((item) => item.startsWith(base + "app/"));
  const srcRouter = tracked.some((item) => item.startsWith(base + "src/app/"));

  if (expo || next) {
    assert(Number(rootRouter) + Number(srcRouter) === 1, `${app} must have exactly one router root`);
  }

  if (expo) {
    for (const file of [
      ".easignore",
      "app.config.ts",
      "eas.json",
      "fingerprint.config.js",
      "index.js",
      "metro.config.cjs",
      "mobile.config.json",
      "tsconfig.json",
    ]) {
      assert(set.has(base + file), `${base}${file} missing`);
    }
    const router = srcRouter ? "src/app/" : "app/";
    for (const file of ["_layout.tsx", "index.tsx"]) {
      assert(set.has(base + router + file), `${base}${router}${file} missing`);
    }
  }

  if (next) {
    const router = srcRouter ? "src/app/" : "app/";
    for (const file of ["layout.tsx", "page.tsx"]) {
      assert(set.has(base + router + file), `${base}${router}${file} missing`);
    }
    assert(set.has(base + "tsconfig.json"), `${base}tsconfig.json missing`);
  }

  assert(
    expo || next || Object.keys(value.targets ?? {}).some((name) => ["build", "serve", "dev"].includes(name)),
    `${app} has no deployable/runtime target`,
  );
}

const services = children("services");
const appSet = new Set(apps);
for (const service of services) {
  const value = project("services", service, "type:service");
  if (!value) continue;
  const base = `services/${service}/`;
  assert(value.projectType === "application", `${base} projectType must be application`);
  assert(set.has(base + "README.md"), `${service} README missing`);

  for (const bucket of ["shared", "common", "core"]) {
    assert(
      !tracked.some((item) => item.startsWith(`${base}${bucket}/`)),
      `${service} generic ${bucket} ownership is forbidden`,
    );
  }
  assert(!tracked.some((item) => item.startsWith(base + "frontend/")), `${service} frontend tree is forbidden`);

  if (set.has(base + "backend/go.mod")) {
    assert(set.has(base + "backend/Dockerfile"), `${base}backend/Dockerfile missing`);
    const processMains = tracked.filter((item) => new RegExp(`^${base}backend/cmd/[^/]+/main\\.go$`).test(item));
    assert(processMains.length > 0, `${service} Go backend has no backend/cmd/<process>/main.go`);
  }

  for (const lane of ["contracts/", "database/", "tests/"]) {
    const files = tracked.filter((item) => item.startsWith(base + lane));
    if (files.length) {
      assert(files.some((item) => !item.endsWith("/README.md")), `${service} has empty admitted lane ${lane}`);
    }
  }

  const flat = base + `contracts/${service}.openapi.yaml`;
  const modular = base + `contracts/openapi/${service}.openapi.yaml`;
  const hasFlat = set.has(flat);
  const hasModular = set.has(modular);
  const modularFiles = tracked.filter((item) => item.startsWith(base + "contracts/openapi/"));
  assert(!(hasFlat && hasModular), `${service} has parallel authored OpenAPI entrypoints`);
  if (modularFiles.length) {
    assert(hasModular, `${service} modular OpenAPI requires ${modular}`);
  }

  const migrationRoots = new Set();
  for (const item of tracked.filter((entry) => entry.startsWith(base))) {
    const match = item.match(new RegExp(`^${base}(.*/)?migrations?/`, "i"));
    if (!match) continue;
    const index = item.toLowerCase().indexOf("/migrations/");
    const singularIndex = item.toLowerCase().indexOf("/migration/");
    const cut = index >= 0 ? index + "/migrations".length : singularIndex + "/migration".length;
    migrationRoots.add(item.slice(0, cut));
  }
  assert(
    migrationRoots.size <= 1,
    `${service} has parallel migration histories: ${[...migrationRoots].sort().join(",")}`,
  );
}

for (const item of tracked.filter((value) => value.startsWith("services/"))) {
  const segments = item.split("/");
  if (segments.some((segment, index) => index > 1 && appSet.has(segment))) {
    failures.push(`Service contains app-shaped ownership container: ${item}`);
  }
}

for (const item of tracked.filter((value) =>
  value.startsWith("services/") && /\.(go|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml)$/.test(value)
)) {
  const body = fs.readFileSync(path.join(root, item), "utf8");
  if (/(?:\.\.\/)+apps\//.test(body) || /github\.com\/bthwani2-boop\/samrim\/apps\//.test(body)) {
    failures.push(`SERVICE_TO_APP_DEPENDENCY: ${item}`);
  }
}

for (const item of tracked.filter((value) => value.startsWith("contracts/"))) {
  if (item === "contracts/README.md") continue;
  const relative = item.slice("contracts/".length);
  assert(
    ["protocol/", "generated/", "catalog/"].some((prefix) => relative.startsWith(prefix)),
    `Root contract requires protocol/generated/catalog placement: ${item}`,
  );
}

const packages = children("packages");
for (const name of packages) {
  assert(
    !["shared", "common", "core", "utils", "domain", "business-rules"].includes(name),
    `Generic package ownership is forbidden: packages/${name}`,
  );
  const value = project("packages", name, "type:package");
  if (!value) continue;
  const base = `packages/${name}/`;
  assert(value.projectType === "library", `${base} projectType must be library`);
  assert(set.has(base + "package.json"), `${base}package.json missing`);
  for (const lane of ["backend/", "database/", "migrations/", "cmd/"]) {
    assert(
      !tracked.some((item) => item.startsWith(base + lane)),
      `Reusable package contains service/storage lane: ${base}${lane}`,
    );
  }
}

for (const item of tracked.filter((value) => value.startsWith("infra/"))) {
  if (/\/(contracts?|database|migrations?|schema|orders?|wallet|ledger|catalog|checkout|identity)(\/|$)/i.test(item)) {
    failures.push(`Infra contains service/business ownership path: ${item}`);
  }
}

if (failures.length) {
  console.error("REPOSITORY_STRUCTURE=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("PLACEMENT_CONTRACT_BOUNDARY=PASS");
console.log("TOP_LEVEL_TAXONOMY=PASS");
console.log(`DISCOVERED_APPS=${apps.join(",")}`);
console.log(`DISCOVERED_SERVICES=${services.join(",")}`);
console.log(`DISCOVERED_PACKAGES=${packages.join(",")}`);
console.log("ROUTER_ROOT_ATOMICITY=PASS");
console.log("SERVICE_MIGRATION_HISTORY_ATOMICITY=PASS");
console.log("SERVICE_OPENAPI_SOURCE_ATOMICITY=PASS");
console.log("SERVICE_TO_APP_DEPENDENCIES=0");
console.log("HISTORICAL_CUTOVER_GUARDS=0");
console.log("REPOSITORY_STRUCTURE=PASS");
