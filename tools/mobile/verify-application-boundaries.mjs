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
    // Identity, DSH and WLT currently publish only "." in package.json.
    // Reject unexported subpaths without blocking their public SDK roots.
    if (/^@bthwani\/(?:identity|dsh|wlt)\//.test(spec)) {
      issues.push("Private service package subpath is not a declared export: " + spec);
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
function presentationCandidates(base) {
  return [
    ...appNames.flatMap(name => {
      const app = join(base, "apps", name);
      return [
        ...filesIn(join(app, "app")),
        ...filesIn(join(app, "src")),
        ...(existsSync(app) ? readdirSync(app).filter(name => extensions.has(extname(name))).map(name => join(app, name)) : []),
      ];
    }),
    ...["design-system", "tamagui-config"].flatMap(name => filesIn(join(base, "packages", name, "src"))),
    ...["identity", "dsh", "wlt"].flatMap(name => filesIn(join(base, "services", name, "clients"))),
  ];
}
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
        // Removed packages can leave an ignored node_modules directory behind.
        // It is not authored source or a workspace owner. Still reject empty
        // or source-bearing unknown owners, including ones with node_modules.
        const contents = readdirSync(join(base, group, entry.name));
        if (contents.length > 0 && contents.every(name => ignored.has(name))) continue;
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
// Validate authored presentation directory ownership at every depth. The
// path rule is independent of import scanning, so a newly created directory
// containing no TS file still cannot bypass the repository placement contract.
const featureName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const featureLayers = new Set(["screens", "components", "hooks", "queries", "mappers", "state", "tests"]);
const operatorServerLayers = new Set(["auth", "clients", "transport"]);
const ambiguousDirectories = new Set(["common", "shared", "misc", "legacy", "new", "v2"]);
const historicalMerchantNames = new Set(["partner", "partners", "partner-onboarding"]);

export function presentationDirectoryIssues(base = root) {
  const issues = [];
  for (const appName of appNames) {
    const appBase = join(base, "apps", appName);
    const roots = [join(appBase, "src"), join(appBase, "app")];
    for (const treeRoot of roots) {
      if (!existsSync(treeRoot)) continue;
      const examine = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (ignored.has(entry.name)) continue;
          const absolute = join(directory, entry.name);
          const label = relative(appBase, absolute).replaceAll("\\", "/");
          if (entry.isSymbolicLink()) {
            issues.push(label + ": presentation directory symlink is not approved");
            continue;
          }
          if (entry.isFile()) {
            const parts = relative(treeRoot, absolute).split(/[\\/]/);
            if (treeRoot.endsWith("src") && extensions.has(extname(entry.name))) {
              if (parts.length === 1 || (parts[0] === "features" && parts.length === 2)) {
                issues.push(label + ": presentation source must belong to a named feature or justified app-local owner");
              }
            }
            if (treeRoot.endsWith("src") && parts[0] === "features" &&
                extensions.has(extname(entry.name)) &&
                !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.(?:native|web|android|ios))?(?:\.(?:test|spec))?\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
              issues.push(label + ": feature source filename must be lowercase-kebab-case");
            }
            continue;
          }
          if (!entry.isDirectory()) continue;
          const parts = relative(treeRoot, absolute).split(/[\\/]/);
          const name = parts.at(-1);
          if (historicalMerchantNames.has(name.toLowerCase())) {
            issues.push(label + ": Use Merchant/merchants naming, not Partner");
          }
          if (treeRoot.endsWith("src")) {
            if (parts.length === 1) {
              const allowed = appName === "control-panel" ?
                new Set(["features", "server", "components", "providers"]) :
                new Set(["features", "components", "providers"]);
              if (name !== "app" && !allowed.has(name)) {
                issues.push(label + ": unapproved presentation root under src/");
              }
            } else if (parts[0] === "features") {
              if (parts.length === 2 && (!featureName.test(name) ||
                  ambiguousDirectories.has(name) || name === "features" ||
                  historicalMerchantNames.has(name))) {
                issues.push(label + ": feature name must be lowercase-kebab-case and owner-specific");
              }
              if (parts.length === 3 && !featureLayers.has(name)) {
                issues.push(label + ": unapproved feature layer; use a named screen, component, hook, query, mapper, state or test");
              }
              if (parts.length > 3 && (!featureName.test(name) || ambiguousDirectories.has(name))) {
                issues.push(label + ": nested feature directory must be lowercase-kebab-case and meaningful");
              }
            } else if (parts[0] === "server" && appName === "control-panel") {
              if (parts.length === 2 && !operatorServerLayers.has(name)) {
                issues.push(label + ": unapproved Operator server adapter category");
              } else if (parts.length > 2 && (!featureName.test(name) || ambiguousDirectories.has(name))) {
                issues.push(label + ": Operator server directory must be lowercase-kebab-case");
              }
            }
          }
          examine(absolute);
        }
      };
      examine(treeRoot);
    }
  }
  return issues;
}

// Test the same on-disk feature scanning in fixtures and in CI.
export function scanPresentationBoundaries(base = root) {
  const issues = [...stage4WorkspaceIssues(base), ...presentationDirectoryIssues(base)];
  const candidates = presentationCandidates(base);
  for (const file of candidates) {
    for (const issue of sourceBoundaryIssues(file, readFileSync(file, "utf8"), base)) {
      issues.push(relative(base, file) + ": " + issue);
    }
  }
  return { issues, scanned: candidates.length };
}
const { issues: violations, scanned } = scanPresentationBoundaries();
assert.deepEqual(violations, [], "Presentation owner boundary failure:\n" + violations.join("\n"));
console.log("APP_OWNER_BOUNDARIES_PASS files=" + scanned + " apps=" + appNames.length + " shared_packages=2");
