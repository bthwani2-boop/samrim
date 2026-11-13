#!/usr/bin/env node
// Structural checks for literal imports; not an authorization or runtime boundary.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";

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
// TypeScript 7 exposes its lexical scanner under the pinned unstable/ast
// export, not the pre-7 createSourceFile API. Tokens avoid treating comments
// and string contents as real imports. Computed module calls fail closed.
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
export function sourceBoundaryIssues(file, source, base = root) {
  const issues = [];
  const current = ownerOf(file, base);
  if (!current) return issues;
  const references = moduleReferences(source);
  issues.push(...references.issues);
  for (const spec of references.specs) {
    // Renderer ownership: Expo uses Tamagui/native modules; Operator uses Ant/Next.
    if (current === "apps/control-panel" &&
        /^(?:tamagui(?:\/|$)|@tamagui\/|@bthwani\/tamagui-config(?:\/|$)|react-native(?:[-/]|$)|expo(?:[-/]|$)|@expo\/)/.test(spec)) {
      issues.push("Operator cannot import Expo/Tamagui renderer: " + spec);
      continue;
    }
    if ((current === "apps/customer" || current === "apps/merchant" || current === "apps/captain" ||
        current === "packages/tamagui-config") &&
        /^(?:antd(?:\/|$)|@ant-design\/|@rc-component\/|next(?:\/|$)|@next\/)/.test(spec)) {
      issues.push("Expo renderer cannot import Ant/Next: " + spec);
      continue;
    }
    if (current === "packages/design-system" &&
        /^(?:tamagui(?:\/|$)|@tamagui\/|@bthwani\/tamagui-config(?:\/|$)|antd(?:\/|$)|@ant-design\/|react-native(?:[-/]|$)|expo(?:[-/]|$)|next(?:\/|$))/.test(spec)) {
      issues.push("Semantic design source cannot depend on a renderer: " + spec);
      continue;
    }
    const appPackage = /^@bthwani\/(customer|merchant|captain|control-panel)(?:\/|$)/.exec(spec);
    if (appPackage && current !== "apps/" + appPackage[1]) {
      issues.push("Cross-app package import " + current + " -> apps/" + appPackage[1] + ": " + spec);
      continue;
    }
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
// The Stage-4 workspace admits exactly four app hosts, two presentation
// packages and three service client scaffolds. Unknown directories must not
// silently avoid the scanner when the root workspace globs include them.
export function stage4WorkspaceIssues(base = root) {
  const issues = [];
  for (const [group, allowed] of [
    ["apps", appNames], ["packages", ["design-system", "tamagui-config"]],
    ["services", ["identity", "dsh", "wlt"]],
  ]) {
    for (const entry of readdirSync(join(base, group), { withFileTypes: true })) {
      if (entry.isDirectory() && !ignored.has(entry.name) && !allowed.includes(entry.name)) {
        issues.push(group + "/" + entry.name + ": unapproved Stage-4 owner");
      }
    }
  }
  for (const name of appNames) {
    if (existsSync(join(base, "apps", name, "src", "app"))) {
      issues.push(name + ": src/app is not the approved route root; use app/ only");
    }
  }
  return issues;
}
const violations = stage4WorkspaceIssues();
for (const file of candidates) {
  for (const issue of sourceBoundaryIssues(file, readFileSync(file, "utf8"))) {
    violations.push(relative(root, file) + ": " + issue);
  }
}
assert.deepEqual(violations, [], "Presentation owner boundary failure:\n" + violations.join("\n"));
console.log("APP_OWNER_BOUNDARIES_PASS files=" + candidates.length + " apps=" + appNames.length + " shared_packages=2");
