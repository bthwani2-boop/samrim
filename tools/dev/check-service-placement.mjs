// Enforce the authored service tree before dependency installation.
// Generated dependencies are scoped to the actual owner package root.
import { lstatSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const owners = new Set(["identity", "dsh", "wlt"]);
const packageName = /^[a-z][a-z0-9]*$/;
const forbiddenDomain = new Set(["misc", "legacy", "partners"]);
const baselineName = /^\d{2}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.sql$/;
const fragmentName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/;
const ownerOutput = new Set(["node_modules", "dist", "build", "coverage"]);

function isDomain(name) {
  return packageName.test(name) && !forbiddenDomain.has(name);
}

function checkPlacement(owner, parts, directory, report) {
  const [area, section, group, name] = parts;
  const deprecatedContract = area === "contracts" && section === "openapi" && group === "path";
  const internal = area === "backend" && section === "internal";
  if (directory) {
    if (internal && parts.length >= 3 && !isDomain(group)) {
      report("Go internal package must be a named owner domain");
    }
    if (deprecatedContract) report("OpenAPI fragments belong in paths/, not path/");
    return;
  }

  const extension = extname(parts.at(-1)).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    const entrypoint = area === "contracts" && section === "openapi" &&
      parts.length === 3 && group === `${owner}.openapi.yaml`;
    const fragment = area === "contracts" && section === "openapi" && group === "paths" &&
      parts.length === 4 && fragmentName.test(name);
    if (!entrypoint && !fragment && !deprecatedContract) {
      report("owner OpenAPI YAML belongs to its entrypoint or flat paths/ modules");
    }
  }
  if (extension === ".go") {
    const command = area === "backend" && section === "cmd" && group === owner && parts.length === 4;
    const domain = internal && parts.length >= 4 && parts.slice(2, -1).every(isDomain);
    if (!command && !domain) {
      report(`Go source belongs in backend/cmd/${owner}/ or backend/internal/<domain>/`);
    }
  }
  if (area === "database" && section === "migrations") {
    report("BASELINE_FIRST: edit owner database/schema/; retained migrations require a separately approved epoch");
    return;
  }
  if (extension === ".sql") {
    const valid = area === "database" && parts.length === 3 &&
      (section === "schema" || (owner === "wlt" && section === "sandbox")) &&
      baselineName.test(group);
    if (!valid) report("SQL belongs in numbered owner schema/ or WLT sandbox/");
  }
}

function inspectOwner(root, owner, issues) {
  function walk(folder, parent) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const parts = [...parent, entry.name];
      const rel = ["services", owner, ...parts].join("/");
      const report = reason => issues.push(`${rel}: ${reason}`);
      const absolute = join(folder, entry.name);
      const info = lstatSync(absolute);
      // Only the owner package root has admitted dependency/build output.
      // Never omit an arbitrary backend, SQL or contract subtree by basename.
      if (parts.length === 1 && ownerOutput.has(entry.name) &&
          (info.isDirectory() || (entry.name === "node_modules" && info.isSymbolicLink()))) continue;
      if (info.isSymbolicLink()) {
        report("service source symlink is not an authorized owner path");
      } else if (entry.name === ".git" || entry.name === "node_modules") {
        report("nested repository or dependency root is not an authorized owner path");
      } else if (info.isDirectory()) {
        checkPlacement(owner, parts, true, report);
        walk(absolute, parts);
      } else if (info.isFile()) {
        checkPlacement(owner, parts, false, report);
      } else {
        report("service source entry must be a regular file or directory");
      }
    }
  }
  walk(root, []);
}

export function serviceSourcePlacementIssues(base) {
  const root = join(base, "services");
  const rootInfo = lstatSync(root, { throwIfNoEntry: false });
  if (!rootInfo) return [];
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    return ["services: service source root must be an actual directory"];
  }

  const issues = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    const info = lstatSync(absolute);
    const rel = `services/${entry.name}`;
    if (owners.has(entry.name) && info.isDirectory() && !info.isSymbolicLink()) {
      inspectOwner(absolute, entry.name, issues);
    } else if (info.isFile()) {
      issues.push(`${rel}: unowned service root file`);
    } else {
      issues.push(`${rel}: unapproved service owner or source link`);
    }
  }
  return issues.sort();
}
