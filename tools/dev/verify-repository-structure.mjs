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
  .map((item) => item.replaceAll("\\", "/"))
  .filter((item) => fs.existsSync(path.join(repoRoot, item)));

const trackedSet = new Set(tracked);
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    failures.push(relativePath + " is missing or invalid JSON: " + error.message);
    return null;
  }
}

function directChildren(rootName) {
  return [...new Set(
    tracked
      .filter((item) => item.startsWith(rootName + "/"))
      .map((item) => item.slice(rootName.length + 1))
      .filter((item) => item.includes("/"))
      .map((item) => item.split("/", 1)[0]),
  )].sort();
}

function projectFor(rootName, name, expectedTag) {
  const base = rootName + "/" + name + "/";
  const projectPath = base + "project.json";
  assert(trackedSet.has(projectPath), base + " must contain project.json");
  if (!trackedSet.has(projectPath)) return null;

  const project = readJson(projectPath);
  if (!project) return null;

  assert(project.root === rootName + "/" + name, projectPath + " root must equal its repository path");
  assert(project.name === name, projectPath + " name must equal direct child directory name");
  assert(Array.isArray(project.tags) && project.tags.includes(expectedTag), projectPath + " missing " + expectedTag);
  return { base, project };
}

const allowedTopLevelDirectories = new Set([
  ".github",
  "apps",
  "contracts",
  "infra",
  "packages",
  "services",
  "tools",
]);

const actualTopLevelDirectories = [...new Set(
  tracked
    .filter((item) => item.includes("/"))
    .map((item) => item.split("/", 1)[0]),
)].sort();

for (const top of actualTopLevelDirectories) {
  assert(allowedTopLevelDirectories.has(top), "Unadmitted top-level ownership class tracked: " + top);
}

for (const required of [".github", "tools"]) {
  assert(actualTopLevelDirectories.includes(required), "Required repository knowledge/tooling root missing: " + required);
}

const knowledgeManifest = "knowledge.sources.json";
const repositoryStructureContract = "REPOSITORY-STRUCTURE.md";
const legacyKnowledgeManifest = ["governance", "lock", "json"].join(".");
assert(trackedSet.has(knowledgeManifest), knowledgeManifest + " is required as the canonical knowledge/evidence source manifest");
assert(trackedSet.has(repositoryStructureContract), repositoryStructureContract + " is required as the repository-local placement contract");
assert(!trackedSet.has(legacyKnowledgeManifest), "retired knowledge manifest must not remain tracked: " + legacyKnowledgeManifest);

for (const file of tracked) {
  const absolute = path.join(repoRoot, file);
  if (!fs.statSync(absolute).isFile()) continue;
  let content;
  try {
    content = fs.readFileSync(absolute, "utf8");
  } catch {
    continue;
  }
  if (content.includes(legacyKnowledgeManifest)) failures.push("tracked artifact retains retired knowledge-manifest reference: " + file);
}

for (const forbiddenRoot of ["core/", "shared/"]) {
  assert(
    !tracked.some((item) => item.startsWith(forbiddenRoot)),
    "Forbidden top-level ownership class tracked: " + forbiddenRoot,
  );
}

const packageManagerLockfiles = tracked.filter((item) =>
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(item),
);
assert(
  packageManagerLockfiles.length === 1 && packageManagerLockfiles[0] === "pnpm-lock.yaml",
  "Canonical package-manager lockfile must be exactly pnpm-lock.yaml; found: " + packageManagerLockfiles.join(", "),
);

assert(
  !tracked.some((item) => /^apps\/[^/]+\/runtime\//.test(item)),
  "Pass-through apps/*/runtime topology is forbidden",
);

const appNames = directChildren("apps");
for (const app of appNames) {
  const record = projectFor("apps", app, "type:app");
  if (!record) continue;

  const { base, project } = record;
  assert(project.projectType === "application", base + " projectType must be application");
  for (const relative of ["README.md", "package.json"]) {
    assert(trackedSet.has(base + relative), app + " missing deployable host substrate: " + relative);
  }

  const isExpo = trackedSet.has(base + "mobile.config.json") || trackedSet.has(base + "app.config.ts");
  const isNext = trackedSet.has(base + "next.config.ts") || trackedSet.has(base + "next.config.js") || trackedSet.has(base + "next.config.mjs");

  if (isExpo) {
    for (const relative of [
      ".easignore",
      "app.config.ts",
      "eas.json",
      "fingerprint.config.js",
      "index.js",
      "metro.config.cjs",
      "mobile.config.json",
      "tsconfig.json",
    ]) {
      assert(trackedSet.has(base + relative), app + " missing Expo host substrate: " + relative);
    }

    const hasRootRouter = tracked.some((item) => item.startsWith(base + "app/"));
    const hasSrcRouter = tracked.some((item) => item.startsWith(base + "src/app/"));
    assert(
      Number(hasRootRouter) + Number(hasSrcRouter) === 1,
      app + " must have exactly one Expo router root: app/ or src/app/",
    );
    const routerRoot = hasSrcRouter ? "src/app/" : "app/";
    for (const relative of [routerRoot + "_layout.tsx", routerRoot + "index.tsx"]) {
      assert(trackedSet.has(base + relative), app + " missing Expo route substrate: " + relative);
    }
  }

  if (isNext) {
    const hasNextConfig = trackedSet.has(base + "next.config.ts") || trackedSet.has(base + "next.config.js") || trackedSet.has(base + "next.config.mjs");
    assert(hasNextConfig, app + " missing Next config substrate");

    const hasRootRouter = tracked.some((item) => item.startsWith(base + "app/"));
    const hasSrcRouter = tracked.some((item) => item.startsWith(base + "src/app/"));
    assert(
      Number(hasRootRouter) + Number(hasSrcRouter) === 1,
      app + " must have exactly one Next router root: app/ or src/app/",
    );
    const routerRoot = hasSrcRouter ? "src/app/" : "app/";
    for (const relative of [routerRoot + "layout.tsx", routerRoot + "page.tsx", "tsconfig.json"]) {
      assert(trackedSet.has(base + relative), app + " missing Next host substrate: " + relative);
    }
  }

  assert(isExpo || isNext || Object.keys(project.targets ?? {}).some((name) => ["build", "serve", "dev"].includes(name)),
    app + " has no recognized deployable/runtime target");
}

assert(
  !tracked.some((item) => item.startsWith("apps/control-panel/app/components/")),
  "Control Panel non-route ownership must not remain under app/components/",
);
assert(
  !tracked.some((item) => item.startsWith("apps/control-panel/lib/")),
  "Control Panel non-route ownership must not remain under lib/",
);

for (const mobileApp of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const legacyFlat = tracked.filter((item) => new RegExp(`^apps/${mobileApp}/src/[^/]+\\.(?:ts|tsx)$`).test(item));
  assert(
    legacyFlat.length === 0,
    `${mobileApp} retains flat non-route source placement: ${legacyFlat.join(", ")}`,
  );
  assert(
    !tracked.some((item) => item.startsWith(`apps/${mobileApp}/src/app/`)),
    `${mobileApp} must keep the current root app/ router until an atomic cutover`,
  );
}

const serviceNames = directChildren("services");
for (const service of serviceNames) {
  const record = projectFor("services", service, "type:service");
  if (!record) continue;

  const { base, project } = record;
  assert(project.projectType === "application", base + " projectType must be application");
  assert(trackedSet.has(base + "README.md"), service + " missing service README.md");

  const hasGoBackend = trackedSet.has(base + "backend/go.mod");
  if (hasGoBackend) {
    for (const relative of ["backend/Dockerfile", "backend/cmd/api/main.go", "backend/internal/runtime/server.go"]) {
      assert(trackedSet.has(base + relative), service + " missing Go service substrate: " + relative);
    }
  }

  for (const lane of ["contracts/", "database/", "tests/"]) {
    const laneFiles = tracked.filter((item) => item.startsWith(base + lane));
    if (laneFiles.length > 0) {
      const materialLaneFiles = laneFiles.filter((item) => !item.endsWith("/README.md"));
      assert(materialLaneFiles.length > 0, service + " has an empty admitted lane: " + lane);
    }
  }

  const flatOpenApiEntrypoint = base + `contracts/${service}.openapi.yaml`;
  const modularOpenApiEntrypoint = base + `contracts/openapi/${service}.openapi.yaml`;
  const hasFlatOpenApi = trackedSet.has(flatOpenApiEntrypoint);
  const hasModularOpenApi = trackedSet.has(modularOpenApiEntrypoint);
  const modularOpenApiFiles = tracked.filter((item) => item.startsWith(base + "contracts/openapi/"));
  const bundledOpenApi = base + `contracts/generated/${service}.openapi.bundle.yaml`;

  assert(
    !(hasFlatOpenApi && hasModularOpenApi),
    service + " must have at most one authored OpenAPI entrypoint: flat or modular",
  );
  if (modularOpenApiFiles.length > 0) {
    assert(
      hasModularOpenApi,
      service + " modular OpenAPI tree requires canonical entrypoint: " + modularOpenApiEntrypoint,
    );
  }
  if (trackedSet.has(bundledOpenApi)) {
    assert(
      Number(hasFlatOpenApi) + Number(hasModularOpenApi) === 1,
      service + " tracked OpenAPI bundle requires exactly one authored canonical OpenAPI entrypoint",
    );
  }
}

const dshMigrationFiles = tracked.filter((item) => /^services\/dsh\/.*\.sql$/i.test(item));
const dshCanonicalMigrations = dshMigrationFiles.filter((item) => item.startsWith("services/dsh/database/migrations/"));
const dshLegacyMigrations = dshMigrationFiles.filter((item) => item.startsWith("services/dsh/backend/internal/storage/postgres/"));
assert(
  dshLegacyMigrations.length === 0,
  "DSH migration SQL must not remain under backend/internal/storage/postgres: " + dshLegacyMigrations.join(", "),
);
if (dshMigrationFiles.length > 0) {
  assert(
    dshCanonicalMigrations.length === dshMigrationFiles.length,
    "DSH migration history must have one canonical location under services/dsh/database/migrations/",
  );
  assert(
    dshCanonicalMigrations.includes("services/dsh/database/migrations/001_partner_store_baseline.sql"),
    "DSH canonical baseline migration is missing",
  );
}

assert(
  !tracked.some((item) => item.startsWith("services/dsh/backend/internal/identityboundary/")),
  "DSH Identity integration must not remain under the legacy identityboundary path",
);
assert(
  tracked.includes("services/dsh/backend/internal/integrations/identity/client.go"),
  "DSH Identity integration must have one canonical adapter under internal/integrations/identity/",
);
assert(
  tracked.includes("services/dsh/backend/internal/transport/http/managedaccess.go") &&
    tracked.includes("services/dsh/backend/internal/transport/http/partnerbootstrap.go"),
  "DSH HTTP route adaptation must be owned by internal/transport/http/",
);
assert(
  !tracked.includes("services/dsh/backend/internal/managedaccess/server.go") &&
    !tracked.includes("services/dsh/backend/internal/partnerbootstrap/server.go"),
  "DSH capabilities must not retain mixed HTTP server files",
);

const forbiddenAppContainers = new Set(appNames);
for (const item of tracked) {
  if (!item.startsWith("services/")) continue;
  const segments = item.split("/");
  if (segments.some((segment, index) => index > 1 && forbiddenAppContainers.has(segment))) failures.push("Service contains app-shaped ownership container: " + item);
  if (/^services\/[^/]+\/frontend\//.test(item)) failures.push("Service contains non-admitted frontend tree: " + item);
}

const codeLikeServiceFiles = tracked.filter(
  (item) => item.startsWith("services/") && /\.(go|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml)$/.test(item),
);
for (const item of codeLikeServiceFiles) {
  const content = fs.readFileSync(path.join(repoRoot, item), "utf8");
  if (/github\.com\/bthwani2-boop\/samrim\/apps\//.test(content) || /(?:\.\.\/)+apps\//.test(content)) failures.push("SERVICE_TO_APP_DEPENDENCY: " + item);
}

const rootContractFiles = tracked.filter((item) => item.startsWith("contracts/"));
for (const item of rootContractFiles) {
  if (item === "contracts/README.md") continue;
  const relative = item.slice("contracts/".length);
  if (!relative.startsWith("protocol/") && !relative.startsWith("generated/") && !relative.startsWith("catalog/")) {
    failures.push("Root contracts file requires explicit cross-service protocol/generated/catalog placement: " + item);
  }
}

const packageNames = directChildren("packages");
for (const packageName of packageNames) {
  const record = projectFor("packages", packageName, "type:package");
  if (!record) continue;
  const { base, project } = record;
  assert(project.projectType === "library", base + " projectType must be library");
  assert(trackedSet.has(base + "package.json"), packageName + " missing package.json");
  for (const forbidden of ["backend/", "database/", "migrations/", "cmd/"]) {
    assert(!tracked.some((item) => item.startsWith(base + forbidden)), "Reusable package contains service/storage ownership lane: " + base + forbidden);
  }
}

for (const item of tracked) {
  if (!item.startsWith("infra/")) continue;
  if (/\/(?:contracts?|database|migrations?|schema)(?:\/|$)/i.test(item) || /\/(?:orders?|wallet|ledger|catalog|checkout|identity)(?:\/|$)/i.test(item)) {
    failures.push("Infra contains service/business ownership path: " + item);
  }
}

if (failures.length) {
  console.error("REPOSITORY_STRUCTURE=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

console.log("TOP_LEVEL_TAXONOMY=PASS");
console.log("DISCOVERED_APPS=" + appNames.join(","));
console.log("DISCOVERED_SERVICES=" + serviceNames.join(","));
console.log("DISCOVERED_PACKAGES=" + packageNames.join(","));
console.log("DIRECT_DEPLOYABLE_HOST_ROOTS=PASS");
console.log("ROUTER_ROOT_ATOMICITY=PASS");
console.log("SERVICE_OPENAPI_SOURCE_ATOMICITY=PASS");
console.log("SERVICE_TO_APP_DEPENDENCIES=0");
console.log("SERVICE_FRONTEND_TREES=0");
console.log("ROOT_CONTRACT_PLACEMENT=PASS");
console.log("PACKAGES_TECHNICAL_BOUNDARY=PASS");
console.log("INFRA_OWNERSHIP_BOUNDARY=PASS");
console.log("MANUAL_PROJECT_NAME_REGISTRY=0");
console.log("KNOWLEDGE_SOURCE_MANIFEST=PASS");
console.log("REPOSITORY_PLACEMENT_CONTRACT=PASS");
console.log("RETIRED_KNOWLEDGE_MANIFEST_REFERENCES=0");
console.log("REPOSITORY_STRUCTURE=PASS");
