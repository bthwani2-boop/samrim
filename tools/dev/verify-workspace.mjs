#!/usr/bin/env node
// Pre-install source admission. Native pnpm, Go, tests and runtime acceptance
// remain separate; these static checks do not certify their execution.
import assert from "node:assert/strict";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readVerifiedFile, samePath } from "../security/verify-secrets.mjs";
import { resolvePinnedGo, services } from "./check-go.mjs";
import { serviceSourcePlacementIssues } from "./check-service-placement.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tools = new Set(["@babel/parser", "@biomejs/biome", "knip", "nx", "parse5", "typescript", "yaml"]);
const projects = ["apps/customer", "apps/merchant", "apps/captain", "apps/control-panel",
  "packages/design-system", "packages/tamagui-config"];
const requiredSources = ["knip.jsonc", ".editorconfig", ".gitattributes",
  "tools/mobile/define-bthwani-expo-app.cjs", "tools/mobile/verify-app-identity.mjs",
  "patches/@rc-component__util@1.14.0.patch", "docs/README.md"];
const retiredSources = ["docs/journeys", "docs/reference/README.md", "contracts", "go.work",
  "apps/app-client", "apps/app-partner", "apps/app-captain", "tools/mobile/create-bthwani-metro-config.cjs"];

function pin(value, label) {
  assert.match(value ?? "", /^\d+\.\d+\.\d+$/, "Expected exact stable version: " + label);
  return value;
}

function sourceReader(checkout) {
  const base = path.resolve(checkout);
  const locate = rel => path.join(base, rel);
  function read(rel) {
    const file = locate(rel);
    assert.ok(lstatSync(file, { throwIfNoEntry: false })?.isFile(),
      "Required source must be a real file: " + rel);
    const { bytes } = readVerifiedFile(file, 4 * 1024 * 1024);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
  }
  return {
    read,
    json: rel => JSON.parse(read(rel)),
    directory(rel) {
      const file = locate(rel);
      const stat = lstatSync(file, { throwIfNoEntry: false });
      assert.ok(stat?.isDirectory() && !stat.isSymbolicLink() &&
        samePath(realpathSync.native(file), file), "Required source directory: " + rel);
    },
    absent(rel) {
      assert.ok(!lstatSync(locate(rel), { throwIfNoEntry: false }), "Retired source path returned: " + rel);
    },
  };
}

// pnpm 12 stores package-manager and workspace lock documents separately.
// Admit actual importer pins, leaving complete graph validation to native
// frozen installation. No third dependency-version registry.
function importer(document, name) {
  const section = document.match(/^importers:\n([\s\S]*?)(?=^[^\s#][^\n]*:\s*$)/m)?.[1];
  assert.ok(section, "Missing frozen lock importers");
  const header = new RegExp("^  " + RegExp.escape(name) + ":\\n", "m");
  const match = header.exec(section);
  assert.ok(match, "Missing frozen lock importer: " + name);
  const remaining = section.slice(match.index + match[0].length);
  const next = remaining.search(/^  \S[^\n]*:\s*$/m);
  return next === -1 ? remaining : remaining.slice(0, next);
}

function locked(imported, name, version) {
  const key = name.startsWith("@") ? "'" + name + "'" : name;
  const expected = new RegExp("^      " + RegExp.escape(key) +
    ":\\n        specifier: " + RegExp.escape(version) +
    "\\n        version: " + RegExp.escape(version) + "$", "m");
  assert.match(imported, expected, "Frozen lock pin differs: " + name);
}

function verifyLock(document, manifest, pnpm) {
  const documents = document.split(/^---$/m).filter(value => value.trim());
  assert.equal(documents.length, 2, "Expected pnpm package-manager and workspace lock documents");
  for (const item of documents) assert.match(item, /^lockfileVersion: '9\.0'$/m);
  const manager = documents.find(item => /^    packageManagerDependencies:$/m.test(item));
  const dependency = documents.find(item => /^    devDependencies:$/m.test(item));
  assert.ok(manager && dependency && manager !== dependency, "Missing distinct frozen lock documents");
  const managerRoot = importer(manager, ".");
  assert.match(managerRoot, /^    packageManagerDependencies:$/m);
  locked(managerRoot, "pnpm", pnpm);
  const workspaceRoot = importer(dependency, ".");
  assert.match(workspaceRoot, /^    devDependencies:$/m);
  for (const tool of tools) locked(workspaceRoot, tool, manifest.devDependencies[tool]);
  return dependency;
}

function verifyWorkspaceSettings(workspace, nx) {
  for (const glob of ["apps/*", "services/*", "packages/*"]) {
    assert.match(workspace, new RegExp('^  - "' + RegExp.escape(glob) + '"$', "m"),
      "Missing canonical workspace path: " + glob);
  }
  for (const [key, value] of Object.entries({
    autoInstallPeers: "false", engineStrict: "true", frozenLockfile: "true",
    nodeLinker: "isolated", saveExact: "true", sharedWorkspaceLockfile: "true",
    strictPeerDependencies: "true",
  })) {
    assert.match(workspace, new RegExp("^" + key + ": " + value + "$", "m"),
      "Workspace setting changed: " + key);
  }
  assert.doesNotMatch(workspace, /^\s*nxCloud(?:Id|AccessToken|Url):/m,
    "Nx configuration belongs in nx.json, not pnpm");
  assert.match(workspace, /^  '@rc-component\/util@1\.14\.0': patches\/@rc-component__util@1\.14\.0\.patch$/m);
  assert.equal(nx.defaultBase, "main");
  for (const target of ["typecheck", "theme:check", "theme:verify"]) {
    assert.equal(nx.targetDefaults?.[target]?.cache, true, "Missing declared cache target: " + target);
    assert.ok(nx.targetDefaults[target].inputs?.includes("nodeToolchain"), "Toolchain cache input missing: " + target);
  }
  for (const input of ["{workspaceRoot}/pnpm-lock.yaml", "{workspaceRoot}/pnpm-workspace.yaml",
    "{workspaceRoot}/tsconfig.base.json", "{workspaceRoot}/.node-version"]) {
    assert.ok(nx.namedInputs?.nodeToolchain?.includes(input), "Missing Nx source input: " + input);
  }
  assert.match(nx.nxCloudId ?? "", /^[a-f0-9]{24}$/, "Missing approved dedicated Nx Cloud configuration");
  assert.notEqual(nx.nxCloudId, "6aa9eedc45c07f39423ffa9f", "Do not reuse donor Nx Cloud workspace");
  assert.ok(!Object.hasOwn(nx, "nxCloudAccessToken") && !Object.hasOwn(nx, "nxCloudUrl"),
    "Do not embed Nx Cloud credentials or change its endpoint");
}

function verifyOwner(source, dependency, owner, go, ts) {
  const project = "services/" + owner;
  const client = source.json(project + "/package.json");
  assert.equal(client.name, "@bthwani/" + owner);
  assert.equal(client.private, true);
  assert.equal(client.type, "module");
  assert.equal(client.types, "./clients/index.ts");
  assert.equal(client.scripts?.typecheck, "tsc --noEmit -p tsconfig.json");
  assert.equal(client.devDependencies?.typescript, ts);
  const config = source.json(project + "/tsconfig.json");
  assert.equal(config.extends, "../../tsconfig.base.json");
  assert.equal(config.compilerOptions?.noEmit, true);
  for (const include of ["clients/**/*.ts", "clients/**/*.tsx"]) {
    assert.ok(config.include?.includes(include), "Owner client source is outside TypeScript check: " + owner);
  }
  for (const file of ["README.md", "clients/index.ts", "clients/README.md",
    "contracts/openapi/" + owner + ".openapi.yaml"]) source.read(project + "/" + file);
  const module = source.read(project + "/backend/go.mod");
  assert.match(module, new RegExp("^go " + RegExp.escape(go) + "$", "m"), "Owner Go pin differs: " + owner);
  locked(importer(dependency, project), "typescript", ts);
}

export function verifyWorkspace(checkout = root, { strict = false } = {}) {
  const issues = serviceSourcePlacementIssues(checkout);
  assert.equal(issues.length, 0, "Service source placement violations:\n" + issues.join("\n"));
  const source = sourceReader(checkout);
  const node = pin(source.read(".node-version").trim(), ".node-version");
  const go = pin(source.read(".go-version").trim(), ".go-version");
  assert.equal(source.read(".nvmrc").trim(), node, "Node pin aliases differ");
  assert.equal(process.version, "v" + node, "Active Node runtime mismatch: expected " +
    node + ", observed " + process.version.slice(1) + " at " + process.execPath);

  const manifest = source.json("package.json");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  const pnpm = pin(manifest.packageManager?.match(/^pnpm@(.+)$/)?.[1], "packageManager");
  assert.equal(manifest.engines?.pnpm, pnpm);
  assert.equal(manifest.engines?.node, ">=24.17.0 <25");
  // Membership is a set property, independent of key order or locale.
  assert.deepEqual(new Set(Object.keys(manifest.devDependencies ?? {})), tools);
  for (const tool of tools) pin(manifest.devDependencies[tool], tool);
  assert.ok(!manifest.dependencies?.nx, "Nx must remain a development tool");

  verifyWorkspaceSettings(source.read("pnpm-workspace.yaml"), source.json("nx.json"));
  const dependency = verifyLock(source.read("pnpm-lock.yaml"), manifest, pnpm);
  for (const project of projects) {
    source.directory(project);
    source.read(project + "/package.json");
    importer(dependency, project);
  }
  for (const rel of requiredSources) source.read(rel);
  for (const rel of retiredSources) source.absent(rel);
  const typescript = source.json("tsconfig.base.json");
  assert.equal(typescript.compilerOptions?.strict, true);
  assert.equal(typescript.compilerOptions?.noEmit, true);
  const biome = source.json("biome.json");
  assert.equal(biome.linter?.enabled, true);
  assert.equal(biome.formatter?.enabled, false);
  const ts = manifest.devDependencies.typescript;
  for (const owner of services) verifyOwner(source, dependency, owner, go, ts);
  const ignores = source.read(".gitignore");
  for (const entry of ["node_modules/", ".env", "secrets.local.", "apps/control-panel/next-env.d.ts"]) {
    assert.ok(ignores.includes(entry), "Missing local dependency or secret ignore: " + entry);
  }

  if (strict) resolvePinnedGo(go);
  return { node, go, pnpm, typescript: ts, biome: manifest.devDependencies["@biomejs/biome"],
    nxCloudConfigured: true, localGoVerified: strict };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--require-exact-toolchain"),
    "Usage: node tools/dev/verify-workspace.mjs [--require-exact-toolchain]");
  const result = verifyWorkspace(root, { strict: args.length === 1 });
  console.log("WORKSPACE_SOURCE_PASS pnpm=" + result.pnpm + " typescript=" + result.typescript +
    " biome=" + result.biome + " node-pin=" + result.node + " go-pin=" + result.go +
    " nx_cloud_configured=true nx_cache_execution=NOT_RUN lock=STATIC_ONLY");
  if (result.localGoVerified) console.log("EXACT_LOCAL_TOOLCHAIN_PASS node=" + result.node + " go=" + result.go);
}
