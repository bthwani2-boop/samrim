// Dependency-free admission of the three authored service trees.
// Only generated output at a service package root may be omitted.
import { lstatSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { services } from "./check-go.mjs";

const owners = new Set(services);
const domain = /^[a-z][a-z0-9]*$/;
const retiredDomains = new Set(["misc", "legacy", "partners"]);
const baseline = /^\d{2}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.sql$/;
const fragment = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/;
const generated = new Set(["node_modules", "dist", "build", "coverage"]);
const namedDomain = name => domain.test(name) && !retiredDomains.has(name);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function validateDirectory(parts, report) {
  const [area, section, group] = parts;
  if (area === "backend" && section === "internal" && parts.length >= 3 && !namedDomain(group)) {
    report("Go internal package must be a named owner domain");
  }
  if (area === "contracts" && section === "openapi" && group === "path") {
    report("OpenAPI fragments belong in paths/, not path/");
  }
}

function validateFile(owner, parts, report) {
  const [area, section, group, name] = parts;
  const extension = extname(parts.at(-1)).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    const openapi = area === "contracts" && section === "openapi";
    const valid = openapi && (
      (parts.length === 3 && group === owner + ".openapi.yaml") ||
      (parts.length === 4 && group === "paths" && fragment.test(name))
    );
    // The retired path/ directory is itself reported by directory admission.
    if (!valid && !(openapi && group === "path")) {
      report("owner OpenAPI YAML belongs to its entrypoint or flat paths/ modules");
    }
  }
  if (extension === ".go") {
    const command = area === "backend" && section === "cmd" && group === owner && parts.length === 4;
    const internal = area === "backend" && section === "internal" && parts.length >= 4 &&
      parts.slice(2, -1).every(namedDomain);
    if (!command && !internal) {
      report("Go source belongs in backend/cmd/" + owner + "/ or backend/internal/<domain>/");
    }
  }
  if (area === "database" && section === "migrations") {
    report("BASELINE_FIRST: edit owner database/schema/; retained migrations require a separately approved epoch");
  } else if (extension === ".sql") {
    const valid = area === "database" && parts.length === 3 &&
      (section === "schema" || (owner === "wlt" && section === "sandbox")) && baseline.test(group);
    if (!valid) report("SQL belongs in numbered owner schema/ or WLT sandbox/");
  }
}

export function serviceSourcePlacementIssues(base) {
  const root = join(base, "services");
  const rootStat = lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat) return [];
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return ["services: service source root must be an actual directory"];
  }

  const issues = [];
  // Read the actual entry once; never follow a link or traverse a rejected
  // repository/dependency root. One walk serves all three owners.
  function walk(folder, owner = null, parent = []) {
    for (const entry of readdirSync(folder)) {
      const absolute = join(folder, entry);
      const stat = lstatSync(absolute);
      if (owner === null) {
        if (owners.has(entry) && stat.isDirectory() && !stat.isSymbolicLink()) {
          walk(absolute, entry);
        } else {
          const reason = stat.isFile() ? "unowned service root file" : "unapproved service owner or source link";
          issues.push("services/" + entry + ": " + reason);
        }
        continue;
      }

      const parts = [...parent, entry];
      const rel = ["services", owner, ...parts].join("/");
      const report = reason => issues.push(rel + ": " + reason);
      if (parts.length === 1 && generated.has(entry) &&
          (stat.isDirectory() || (entry === "node_modules" && stat.isSymbolicLink()))) continue;
      if (stat.isSymbolicLink()) {
        report("service source symlink is not an authorized owner path");
      } else if (entry === ".git" || entry === "node_modules") {
        report("nested repository or dependency root is not an authorized owner path");
      } else if (stat.isDirectory()) {
        validateDirectory(parts, report);
        walk(absolute, owner, parts);
      } else if (stat.isFile()) {
        validateFile(owner, parts, report);
      } else {
        report("service source entry must be a regular file or directory");
      }
    }
  }
  walk(root);
  return issues.sort(compare);
}
