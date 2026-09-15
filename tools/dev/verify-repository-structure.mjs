import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).map((p) => p.replaceAll("\\", "/")).filter((p) => fs.existsSync(path.join(root, p)));
const set = new Set(tracked), failures = [];
const assert = (ok, msg) => { if (!ok) failures.push(msg); };
const json = (file) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch (e) { failures.push(`${file}: ${e.message}`); return null; } };
const children = (base) => [...new Set(tracked.filter((p) => p.startsWith(`${base}/`)).map((p) => p.slice(base.length + 1)).filter((p) => p.includes("/")).map((p) => p.split("/", 1)[0]))].sort();
function project(base, name, tag) { const file = `${base}/${name}/project.json`; assert(set.has(file), `${file} missing`); if (!set.has(file)) return null; const p = json(file); if (!p) return null; assert(p.root === `${base}/${name}`, `${file} root mismatch`); assert(p.name === name, `${file} name mismatch`); assert(Array.isArray(p.tags) && p.tags.includes(tag), `${file} missing ${tag}`); return p; }

const allowed = new Set([".github", "apps", "contracts", "infra", "packages", "services", "tools"]);
const tops = [...new Set(tracked.filter((p) => p.includes("/")).map((p) => p.split("/", 1)[0]))].sort();
for (const top of tops) assert(allowed.has(top), `Unadmitted top-level ownership class tracked: ${top}`);
for (const required of [".github", "tools"]) assert(tops.includes(required), `Required repository/tool root missing: ${required}`);

assert(set.has("knowledge.sources.json"), "knowledge.sources.json missing");
assert(set.has("REPOSITORY-STRUCTURE.md"), "REPOSITORY-STRUCTURE.md missing");
const retiredKnowledgeManifest = ["governance", "lock", "json"].join(".");
assert(!set.has(retiredKnowledgeManifest), `retired ${retiredKnowledgeManifest} remains tracked`);
for (const file of tracked) { if (!fs.statSync(path.join(root, file)).isFile()) continue; try { if (fs.readFileSync(path.join(root, file), "utf8").includes(retiredKnowledgeManifest)) failures.push(`retired knowledge-manifest reference: ${file}`); } catch {} }
for (const forbidden of ["core/", "shared/"]) assert(!tracked.some((p) => p.startsWith(forbidden)), `Forbidden top-level ownership class: ${forbidden}`);
const locks = tracked.filter((p) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(p));
assert(locks.length === 1 && locks[0] === "pnpm-lock.yaml", `Canonical package lock must be pnpm-lock.yaml; found ${locks.join(",")}`);
assert(!tracked.some((p) => /^apps\/[^/]+\/runtime\//.test(p)), "Pass-through apps/*/runtime topology is forbidden");

const apps = children("apps");
for (const app of apps) {
  const p = project("apps", app, "type:app"); if (!p) continue;
  const base = `apps/${app}/`; assert(p.projectType === "application", `${base} projectType must be application`);
  for (const f of ["README.md", "package.json"]) assert(set.has(base + f), `${base}${f} missing`);
  const expo = set.has(base + "mobile.config.json") || set.has(base + "app.config.ts");
  const next = ["next.config.ts", "next.config.js", "next.config.mjs"].some((f) => set.has(base + f));
  if (expo) {
    for (const f of [".easignore", "app.config.ts", "eas.json", "fingerprint.config.js", "index.js", "metro.config.cjs", "mobile.config.json", "tsconfig.json"]) assert(set.has(base + f), `${base}${f} missing`);
    const rootRouter = tracked.some((x) => x.startsWith(base + "app/")), srcRouter = tracked.some((x) => x.startsWith(base + "src/app/"));
    assert(Number(rootRouter) + Number(srcRouter) === 1, `${app} must have exactly one Expo router root`);
    const router = srcRouter ? "src/app/" : "app/"; for (const f of ["_layout.tsx", "index.tsx"]) assert(set.has(base + router + f), `${base}${router}${f} missing`);
  }
  if (next) {
    const rootRouter = tracked.some((x) => x.startsWith(base + "app/")), srcRouter = tracked.some((x) => x.startsWith(base + "src/app/"));
    assert(Number(rootRouter) + Number(srcRouter) === 1, `${app} must have exactly one Next router root`);
    const router = srcRouter ? "src/app/" : "app/"; for (const f of ["layout.tsx", "page.tsx"]) assert(set.has(base + router + f), `${base}${router}${f} missing`); assert(set.has(base + "tsconfig.json"), `${base}tsconfig.json missing`);
  }
  assert(expo || next || Object.keys(p.targets ?? {}).some((n) => ["build", "serve", "dev"].includes(n)), `${app} has no deployable/runtime target`);
}
assert(!tracked.some((p) => p.startsWith("apps/control-panel/app/components/")), "Control Panel business ownership under app/components is forbidden");
assert(!tracked.some((p) => p.startsWith("apps/control-panel/lib/")), "Control Panel generic lib ownership is forbidden");
for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
  const flat = tracked.filter((p) => new RegExp(`^apps/${app}/src/[^/]+\\.(ts|tsx)$`).test(p)); assert(flat.length === 0, `${app} flat non-route source remains: ${flat.join(",")}`);
  assert(!tracked.some((p) => p.startsWith(`apps/${app}/src/app/`)), `${app} must keep current root app/ router until atomic cutover`);
}

const services = children("services");
for (const service of services) {
  const p = project("services", service, "type:service"); if (!p) continue; const base = `services/${service}/`;
  assert(p.projectType === "application", `${base} projectType must be application`); assert(set.has(base + "README.md"), `${service} README missing`);
  if (set.has(base + "backend/go.mod")) for (const f of ["backend/Dockerfile", "backend/cmd/api/main.go", "backend/internal/runtime/server.go"]) assert(set.has(base + f), `${base}${f} missing`);
  for (const lane of ["contracts/", "database/", "tests/"]) { const files = tracked.filter((x) => x.startsWith(base + lane)); if (files.length) assert(files.some((x) => !x.endsWith("/README.md")), `${service} has empty admitted lane ${lane}`); }
  const flat = base + `contracts/${service}.openapi.yaml`, modular = base + `contracts/openapi/${service}.openapi.yaml`, hasFlat = set.has(flat), hasModular = set.has(modular), modFiles = tracked.filter((x) => x.startsWith(base + "contracts/openapi/"));
  assert(!(hasFlat && hasModular), `${service} has parallel authored OpenAPI entrypoints`); if (modFiles.length) assert(hasModular, `${service} modular OpenAPI requires ${modular}`);
  for (const lane of ["paths", "schemas", "components"]) { const files = modFiles.filter((x) => x.startsWith(base + `contracts/openapi/${lane}/`)); if (files.length) assert(files.some((x) => !x.endsWith("/README.md")), `${service} OpenAPI ${lane} lane is empty residue`); }
  if (set.has(base + `contracts/generated/${service}.openapi.bundle.yaml`)) assert(Number(hasFlat) + Number(hasModular) === 1, `${service} bundle requires one authored entrypoint`);
}

const dshSql = tracked.filter((p) => /^services\/dsh\/.*\.sql$/i.test(p));
const dshCanonical = dshSql.filter((p) => p.startsWith("services/dsh/database/migrations/"));
assert(!dshSql.some((p) => p.startsWith("services/dsh/backend/internal/storage/postgres/")), "DSH migration SQL remains under storage/postgres");
if (dshSql.length) { assert(dshCanonical.length === dshSql.length, "DSH migration history must have one canonical location"); assert(dshCanonical.includes("services/dsh/database/migrations/001_partner_store_baseline.sql"), "DSH baseline migration missing"); }
assert(!tracked.some((p) => p.startsWith("services/dsh/backend/internal/identityboundary/")), "legacy DSH identityboundary remains");
assert(set.has("services/dsh/backend/internal/integrations/identity/client.go"), "canonical DSH Identity adapter missing");
assert(set.has("services/dsh/backend/internal/transport/http/joiningcase.go") && !set.has("services/dsh/backend/internal/transport/http/managedaccess.go"), "DSH route adaptation ownership mismatch");
assert(!set.has("services/dsh/backend/internal/managedaccess/server.go") && !set.has("services/dsh/backend/internal/partnerbootstrap/server.go"), "DSH mixed capability server residue remains");

const appSet = new Set(apps);
for (const item of tracked.filter((p) => p.startsWith("services/"))) { const seg = item.split("/"); if (seg.some((s, i) => i > 1 && appSet.has(s))) failures.push(`Service contains app-shaped ownership container: ${item}`); if (/^services\/[^/]+\/frontend\//.test(item)) failures.push(`Service contains frontend tree: ${item}`); }
const githubAppPrefixes = [
  "github.com/bthwani2-boop/samrim/apps/",
  "https://github.com/bthwani2-boop/samrim/apps/",
  "http://github.com/bthwani2-boop/samrim/apps/",
];
const hasGithubAppReference = (text) => text
  .split(/[\s"'`()[\]{}<>]+/)
  .some((token) => githubAppPrefixes.some((prefix) => token.startsWith(prefix)));
for (const value of [
  "github.com/bthwani2-boop/samrim/apps/app-client",
  "https://github.com/bthwani2-boop/samrim/apps/app-client",
  "http://github.com/bthwani2-boop/samrim/apps/app-client",
  '"https://github.com/bthwani2-boop/samrim/apps/app-client"',
]) assert(hasGithubAppReference(value), `Repository app-reference matcher rejected canonical value: ${value}`);
for (const value of [
  "https://evil.example/github.com/bthwani2-boop/samrim/apps/app-client",
  "prefixhttps://github.com/bthwani2-boop/samrim/apps/app-client",
  "https://github.com/bthwani2-boop/samrim/apps",
]) assert(!hasGithubAppReference(value), `Repository app-reference matcher accepted invalid value: ${value}`);
for (const item of tracked.filter((p) => p.startsWith("services/") && /\.(go|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml)$/.test(p))) { const text = fs.readFileSync(path.join(root, item), "utf8"); if (hasGithubAppReference(text) || /(?:\.\.\/)+apps\//.test(text)) failures.push(`SERVICE_TO_APP_DEPENDENCY: ${item}`); }
for (const item of tracked.filter((p) => p.startsWith("contracts/"))) { if (item === "contracts/README.md") continue; const rel = item.slice("contracts/".length); if (!["protocol/", "generated/", "catalog/"].some((prefix) => rel.startsWith(prefix))) failures.push(`Root contract requires protocol/generated/catalog placement: ${item}`); }
const packages = children("packages");
for (const name of packages) { const p = project("packages", name, "type:package"); if (!p) continue; const base = `packages/${name}/`; assert(p.projectType === "library", `${base} projectType must be library`); assert(set.has(base + "package.json"), `${base}package.json missing`); for (const f of ["backend/", "database/", "migrations/", "cmd/"]) assert(!tracked.some((x) => x.startsWith(base + f)), `Reusable package contains service/storage lane: ${base}${f}`); }
for (const item of tracked.filter((p) => p.startsWith("infra/"))) if (/\/(contracts?|database|migrations?|schema|orders?|wallet|ledger|catalog|checkout|identity)(\/|$)/i.test(item)) failures.push(`Infra contains service/business ownership path: ${item}`);

if (failures.length) { console.error("REPOSITORY_STRUCTURE=FAIL"); for (const f of [...new Set(failures)].sort()) console.error(`  ${f}`); process.exit(1); }
console.log("TOP_LEVEL_TAXONOMY=PASS");
console.log(`DISCOVERED_APPS=${apps.join(",")}`);
console.log(`DISCOVERED_SERVICES=${services.join(",")}`);
console.log(`DISCOVERED_PACKAGES=${packages.join(",")}`);
console.log("ROUTER_ROOT_ATOMICITY=PASS");
console.log("SERVICE_OPENAPI_SOURCE_ATOMICITY=PASS");
console.log("SERVICE_TO_APP_DEPENDENCIES=0");
console.log("REPOSITORY_STRUCTURE=PASS");
