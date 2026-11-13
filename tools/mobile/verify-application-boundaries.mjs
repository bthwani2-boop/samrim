#!/usr/bin/env node
// Structural checks for literal imports; not an authorization or runtime boundary.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const appNames = ["customer", "merchant", "captain", "control-panel"];
const ownerRoots = ["apps", "packages", "services"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignored = new Set(["node_modules", ".next", ".expo", "dist", "out", "build", "coverage"]);

function within(base, target) {
  const part = relative(base, target);
  return part === "" || (part !== ".." && !part.startsWith("../") && !part.startsWith("..\\") && !part.startsWith("/") && !part.startsWith("\\"));
}
function ownerOf(file, base = root) {
  for (const group of ownerRoots) {
    const groupRoot = join(base, group);
    if (!within(groupRoot, file)) continue;
    const name = relative(groupRoot, file).split(/[\\/]/)[0];
    if (name) return group + "/" + name;
  }
  return null;
}
export function importSpecifiers(source) {
  // Static imports, re-exports, require and literal dynamic imports.
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const specs = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.add(match[1]);
  }
  return [...specs];
}
export function sourceBoundaryIssues(file, source, base = root) {
  const issues = [];
  const current = ownerOf(file, base);
  if (!current) return issues;
  for (const spec of importSpecifiers(source)) {
    if (/^(apps|packages|services)\//.test(spec) || spec.startsWith("@apps/")) {
      issues.push("Use an owner package export, not a private source path: " + spec);
      continue;
    }
    if (spec.startsWith("@bthwani/") &&
        /\/(src|clients|backend|database|contracts)(\/|$)/.test(spec)) {
      issues.push("Private workspace path is not an approved package export: " + spec);
      continue;
    }
    if (!spec.startsWith(".")) continue;
    const destination = ownerOf(resolve(dirname(file), spec), base);
    if (destination && destination !== current) {
      issues.push("Cross-owner source import " + current + " -> " + destination + ": " + spec);
    }
  }
  return issues;
}
function filesIn(folder) {
  if (!existsSync(folder)) return [];
  const result = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) result.push(...filesIn(join(folder, entry.name)));
    else if (entry.isFile() && extensions.has(extname(entry.name))) result.push(join(folder, entry.name));
  }
  return result;
}
const candidates = [
  ...appNames.flatMap(name => {
    const app = join(root, "apps", name);
    return [
      ...filesIn(join(app, "app")),
      ...filesIn(join(app, "src")),
      ...readdirSync(app).filter(name => extensions.has(extname(name))).map(name => join(app, name)),
    ];
  }),
  ...["design-system", "tamagui-config"].flatMap(name => filesIn(join(root, "packages", name, "src"))),
  ...["identity", "dsh", "wlt"].flatMap(name => filesIn(join(root, "services", name, "clients"))),
];
const violations = [];
for (const name of appNames) {
  const app = join(root, "apps", name);
  if (existsSync(join(app, "app")) && existsSync(join(app, "src", "app"))) {
    violations.push(name + ": ambiguous app/ and src/app/ route roots");
  }
}
for (const file of candidates) {
  for (const issue of sourceBoundaryIssues(file, readFileSync(file, "utf8"))) {
    violations.push(relative(root, file) + ": " + issue);
  }
}
assert.deepEqual(violations, [], "Presentation owner boundary failure:\n" + violations.join("\n"));
console.log("APP_OWNER_BOUNDARIES_PASS files=" + candidates.length + " apps=" + appNames.length + " shared_packages=2");
