#!/usr/bin/env node
// Static ownership evidence for the current pnpm workspace; not runtime authorization.
import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createScanner, SyntaxKind } from "@typescript/native/unstable/ast";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const apps = ["customer", "merchant", "captain", "control-panel"];
const services = ["identity", "dsh", "wlt"];
const rendererOwners = new Set(["design-system", "tamagui-config"]);
const groups = ["apps", "packages", "services"];
const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const ignored = new Set(["node_modules", ".next", ".next-dev", ".expo", "dist", "out", "build", "coverage", ".nx"]);
const purposeName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const forbiddenFeatures = new Set(["common", "shared", "misc", "legacy", "new", "v2", "features"]);
const merchantAliases = new Set(["partner", "partners", "partner-onboarding"]);
const featureLayers = new Set(["screens", "components", "hooks", "queries", "mappers", "state", "tests"]);
const serverLayers = new Set(["auth", "clients", "transport"]);
const featureFile = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.(?:native|web|android|ios))?(?:\.(?:test|spec))?\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const nativeRenderer = /^(?:tamagui(?:\/|$)|@tamagui\/|@bthwani\/tamagui-config(?:\/|$)|react-native(?:[-/]|$)|expo(?:[-/]|$)|@expo\/)/;
const operatorRenderer = /^(?:antd(?:\/|$)|@ant-design\/|@rc-component\/|next(?:\/|$)|@next\/)/;
const label = (base, target) => relative(base, target).replaceAll("\\", "/");

function info(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}
function within(base, target) {
  const part = relative(base, target);
  return !isAbsolute(part) && part !== ".." && !part.startsWith("../") && !part.startsWith("..\\");
}
function ownerOf(file, base) {
  for (const group of groups) {
    const folder = join(base, group);
    if (!within(folder, file)) continue;
    const name = label(folder, file).split("/")[0];
    if (name) return group + "/" + name;
  }
  return null;
}

// Reuse the pinned TypeScript 7 lexical scanner: comments are not imports,
// and computed module references are rejected rather than guessed.
function moduleReferences(source) {
  const scanner = createScanner(true, undefined, source);
  const tokens = [];
  const issues = [];
  let previousEnd = -1;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    const end = scanner.getTokenEnd();
    if (end <= previousEnd) {
      issues.push("Module scanner did not advance; source cannot be verified safely");
      break;
    }
    previousEnd = end;
    tokens.push({ kind, text: scanner.getTokenText(), value: scanner.getTokenValue() });
  }
  const specs = new Set();
  const record = (index) => {
    const token = tokens[index];
    if (token && (token.kind === SyntaxKind.StringLiteral ||
        token.kind === SyntaxKind.NoSubstitutionTemplateLiteral)) {
      specs.add(token.value);
    } else {
      issues.push("Computed module specifier cannot be checked for owner isolation");
    }
  };
  const recordCall = (index) => {
    if (tokens[index + 1]?.kind !== SyntaxKind.CloseParenToken) {
      issues.push("Computed module specifier cannot be checked for owner isolation");
    } else record(index);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (token.kind === SyntaxKind.ImportKeyword) {
      if (next?.kind === SyntaxKind.OpenParenToken) recordCall(i + 2);
      else if (next?.kind === SyntaxKind.StringLiteral) record(i + 1);
      else if (next?.kind === SyntaxKind.DotToken &&
          tokens[i + 2]?.text === "meta" && tokens[i + 3]?.kind === SyntaxKind.DotToken &&
          tokens[i + 4]?.text === "resolve" && tokens[i + 5]?.kind === SyntaxKind.OpenParenToken) recordCall(i + 6);
    } else if (token.text === "require") {
      if (next?.kind === SyntaxKind.OpenParenToken) recordCall(i + 2);
      else if (next?.kind === SyntaxKind.DotToken && tokens[i + 2]?.text === "resolve" &&
          tokens[i + 3]?.kind === SyntaxKind.OpenParenToken) recordCall(i + 4);
    } else if (token.text === "from" && next?.kind === SyntaxKind.StringLiteral) {
      record(i + 1);
    }
  }
  return { specs: [...specs], issues };
}
export function importSpecifiers(source) {
  return moduleReferences(source).specs;
}

function exportNames(manifest) {
  const value = manifest?.exports;
  if (typeof value === "string" || Array.isArray(value)) return new Set(["."]);
  if (!value || typeof value !== "object") return new Set();
  const keys = Object.keys(value);
  return new Set(keys.some(key => key.startsWith(".")) ? keys : keys.length ? ["."] : []);
}

function referenceIssues(file, references, base, inventory) {
  const current = ownerOf(file, base);
  if (!current) return [];
  const { specs } = references;
  const issues = [...references.issues];
  const shared = current.startsWith("packages/");
  const mobile = current.startsWith("apps/") && current !== "apps/control-panel" || current === "packages/tamagui-config";
  for (const spec of specs) {
    const workspace = /^@bthwani\/([^/]+)(\/.*)?$/.exec(spec);
    const ownerName = workspace?.[1];
    if (shared && services.includes(ownerName)) {
      issues.push("Presentation package cannot depend on a business owner: " + spec);
    } else if (current === "apps/control-panel" && nativeRenderer.test(spec)) {
      issues.push("Operator cannot import Expo/Tamagui renderer: " + spec);
    } else if (mobile && operatorRenderer.test(spec)) {
      issues.push("Expo renderer cannot import Ant/Next: " + spec);
    } else if (shared && current !== "packages/tamagui-config" && (nativeRenderer.test(spec) || operatorRenderer.test(spec))) {
      issues.push("Semantic design source or domain-neutral shared package cannot depend on a renderer: " + spec);
    } else if (apps.includes(ownerName) && current !== "apps/" + ownerName) {
      issues.push("Cross-app package import " + current + " -> apps/" + ownerName + ": " + spec);
    } else if (/^(apps|packages|services)\//.test(spec) || spec.startsWith("@apps/")) {
      issues.push("Use an owner package export, not a private source path: " + spec);
    } else if (workspace && /\/(src|clients|backend|database|contracts)(\/|$)/.test(spec)) {
      issues.push("Private workspace path is not an approved package export: " + spec);
    } else if (services.includes(ownerName) && workspace?.[2]) {
      issues.push("Private service package subpath is not a declared export: " + spec);
    } else if (workspace && !apps.includes(ownerName) && inventory) {
      const target = inventory.byName.get(ownerName);
      const exported = workspace[2] ? "." + workspace[2] : ".";
      if (!target || (target.manifest && !exportNames(target.manifest).has(exported))) {
        issues.push("Workspace package import is not a declared public export: " + spec);
      }
    } else if (spec.startsWith(".")) {
      const destination = ownerOf(resolve(dirname(file), spec), base);
      if (destination && destination !== current) {
        issues.push("Cross-owner source import " + current + " -> " + destination + ": " + spec);
      }
    }
  }
  return issues;
}

export function sourceBoundaryIssues(file, source, base = root) {
  return referenceIssues(file, moduleReferences(source), base, null);
}

// Inspect directories without following source links or accepting a generated
// dependency-only directory as a new workspace owner.
function safeEntries(folder, issues, base, description) {
  const metadata = info(folder);
  if (!metadata) return [];
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    issues.push(label(base, folder) + ": " + description);
    return [];
  }
  return readdirSync(folder, { withFileTypes: true }).filter(entry => !ignored.has(entry.name));
}
function manifestOf(folder, issues, base) {
  const path = join(folder, "package.json");
  const metadata = info(path);
  if (!metadata) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    issues.push(label(base, path) + ": workspace manifest must be a regular file");
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    issues.push(label(base, path) + ": invalid workspace manifest");
    return null;
  }
}
function sharedPackageIsAdmitted(name, folder, manifest) {
  if (!purposeName.test(name) || forbiddenFeatures.has(name) ||
      apps.includes(name) || services.includes(name) ||
      manifest?.name !== "@bthwani/" + name || manifest.private !== true ||
      !exportNames(manifest).has(".")) return false;
  // Additional neutral packages use explicit local source exports. A package
  // export may have platform/type conditions, but never point outside its owner.
  const validate = value => {
    if (typeof value === "string") {
      if (!value.startsWith("./src/") || value.includes("*")) return false;
      const target = resolve(folder, value);
      const src = join(folder, "src");
      if (!within(src, target) || !info(target)?.isFile()) return false;
      for (let parent = dirname(target); within(src, parent); parent = dirname(parent)) {
        const metadata = info(parent);
        if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return false;
        if (parent === src) break;
      }
      return true;
    }
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length > 0 && Object.entries(value).every(([key, child]) => !key.includes("*") && validate(child));
  };
  return validate(manifest.exports);
}
function workspaceInventory(base) {
  const issues = [];
  const byName = new Map();
  const owners = [];
  for (const group of groups) {
    const groupRoot = join(base, group);
    const entries = safeEntries(groupRoot, issues, base, "workspace root symlink or non-directory is not approved");
    for (const entry of entries) {
      const folder = join(groupRoot, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push(group + "/" + entry.name + ": workspace owner symlink is not approved");
        continue;
      }
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const fixed = group === "apps" ? apps.includes(name) :
        group === "services" ? services.includes(name) : rendererOwners.has(name);
      const content = readdirSync(folder, { withFileTypes: true });
      if (!fixed && content.length > 0 && content.every(item => ignored.has(item.name))) continue;
      const manifest = manifestOf(folder, issues, base);
      const additional = group === "packages" && !fixed;
      if (!fixed && (!additional || !sharedPackageIsAdmitted(name, folder, manifest))) {
        issues.push(group + "/" + name + ": unapproved workspace owner or invalid public package contract");
        continue;
      }
      if (manifest && manifest.name !== "@bthwani/" + name) {
        issues.push(group + "/" + name + ": workspace package identity differs from owner");
      }
      if (byName.has(name)) {
        issues.push(group + "/" + name + ": duplicate workspace owner name");
        continue;
      }
      const owner = { name, group, folder, manifest, additional };
      byName.set(name, owner);
      owners.push(owner);
      if (group === "apps" && info(join(folder, "src", "app"))) {
        issues.push(name + ": src/app is not the approved route root; use app/ only");
      }
    }
  }
  return { owners, byName, issues };
}

export function workspaceOwnerIssues(base = root) {
  return workspaceInventory(base).issues;
}
function sourceFiles(folder, issues, base, walk = true) {
  const files = [];
  for (const entry of safeEntries(folder, issues, base, "source symlink is not approved")) {
    const file = join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      issues.push(label(base, file) + ": source symlink is not approved");
    } else if (entry.isDirectory() && walk) {
      files.push(...sourceFiles(file, issues, base));
    } else if (entry.isFile() && extensions.has(extname(entry.name))) {
      files.push(file);
    }
  }
  return files;
}
function appPlacementIssues(owner, issues) {
  for (const segment of ["src", "app"]) {
    const tree = join(owner.folder, segment);
    const visit = (folder, ancestors) => {
      for (const entry of safeEntries(folder, issues, owner.folder, "presentation directory symlink is not approved")) {
        const file = join(folder, entry.name);
        const parts = [...ancestors, entry.name];
        const path = label(owner.folder, file);
        if (entry.isSymbolicLink()) {
          issues.push(path + ": presentation directory symlink is not approved");
          continue;
        }
        if (entry.isFile()) {
          if (segment === "src" && extensions.has(extname(entry.name))) {
            if (parts.length === 1 || (parts[0] === "features" && parts.length === 2)) {
              issues.push(path + ": presentation source must belong to a named feature or justified app-local owner");
            }
            if (parts[0] === "features" && !featureFile.test(entry.name)) {
              issues.push(path + ": feature source filename must be lowercase-kebab-case");
            }
          }
          continue;
        }
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (merchantAliases.has(name.toLowerCase())) issues.push(path + ": Use Merchant/merchants naming, not Partner");
        if (segment === "src") {
          if (parts.length === 1) {
            const roots = owner.name === "control-panel" ?
              ["features", "server", "components", "providers", "app"] : ["features", "components", "providers", "app"];
            if (!roots.includes(name)) issues.push(path + ": unapproved presentation root under src/");
          } else if (parts[0] === "features") {
            if (parts.length === 3 && !featureLayers.has(name)) {
              issues.push(path + ": unapproved feature layer; use a named screen, component, hook, query, mapper, state or test");
            } else if (parts.length !== 3 && (!purposeName.test(name) || forbiddenFeatures.has(name) || merchantAliases.has(name))) {
              issues.push(path + ": feature name must be lowercase-kebab-case and owner-specific");
            }
          } else if (parts[0] === "server" && owner.name === "control-panel") {
            if (parts.length === 2 ? !serverLayers.has(name) : !purposeName.test(name) || forbiddenFeatures.has(name)) {
              issues.push(path + ": unapproved Operator server adapter category or directory");
            }
          }
        }
        visit(file, parts);
      }
    };
    visit(tree, []);
  }
}

export function scanPresentationBoundaries(base = root) {
  const inventory = workspaceInventory(base);
  const issues = [...inventory.issues];
  const consumers = new Map(inventory.owners.filter(owner => owner.additional).map(owner => [owner.name, new Set()]));
  let scanned = 0;
  for (const owner of inventory.owners) {
    let candidates;
    if (owner.group === "apps") {
      appPlacementIssues(owner, issues);
      candidates = [
        ...sourceFiles(join(owner.folder, "app"), issues, base),
        ...sourceFiles(join(owner.folder, "src"), issues, base),
        ...sourceFiles(owner.folder, issues, base, false),
      ];
    } else {
      candidates = sourceFiles(join(owner.folder, owner.group === "services" ? "clients" : "src"), issues, base);
    }
    for (const file of candidates) {
      scanned++;
      const references = moduleReferences(readFileSync(file, "utf8"));
      for (const issue of referenceIssues(file, references, base, inventory)) {
        issues.push(label(base, file) + ": " + issue);
      }
      for (const spec of references.specs) {
        const name = /^@bthwani\/([^/]+)(?:\/|$)/.exec(spec)?.[1];
        if (name && name !== owner.name && consumers.has(name)) consumers.get(name).add(owner.group + "/" + owner.name);
      }
    }
  }
  for (const [name, readers] of consumers) {
    if (readers.size < 2) issues.push("packages/" + name + ": shared package requires actual multi-owner consumers");
  }
  return { issues: [...new Set(issues)], scanned, packages: inventory.owners.filter(owner => owner.group === "packages").length };
}

const result = scanPresentationBoundaries();
assert.deepEqual(result.issues, [], "Presentation owner boundary failure:\n" + result.issues.join("\n"));
console.log("APP_OWNER_BOUNDARIES_PASS files=" + result.scanned + " apps=" + apps.length + " shared_packages=" + result.packages);
