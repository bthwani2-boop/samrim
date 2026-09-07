import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const projectFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".nx", ".next", "dist", "build", "coverage"].includes(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (entry.isFile() && entry.name === "project.json") {
      projectFiles.push(full);
    }
  }
}

walk(repoRoot);

const allowedTypes = new Set(["app", "service", "package", "infra"]);
const failures = [];
const seenScopes = new Map();

for (const file of projectFiles) {
  const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
  const project = JSON.parse(fs.readFileSync(file, "utf8"));
  const tags = Array.isArray(project.tags) ? project.tags : [];

  const scopes = tags.filter((tag) => typeof tag === "string" && tag.startsWith("scope:"));
  const types = tags.filter((tag) => typeof tag === "string" && tag.startsWith("type:"));

  if (scopes.length !== 1) {
    failures.push(`${relative}: expected exactly one scope:* tag, found ${scopes.length}`);
  }

  if (types.length !== 1) {
    failures.push(`${relative}: expected exactly one type:* tag, found ${types.length}`);
  }

  if (types.length === 1) {
    const type = types[0].slice("type:".length);
    if (!allowedTypes.has(type)) {
      failures.push(`${relative}: unsupported Nx type tag ${types[0]}`);
    }
  }

  if (scopes.length === 1) {
    const scope = scopes[0];
    const previous = seenScopes.get(scope);
    if (previous) {
      failures.push(`${relative}: duplicate ${scope}; already used by ${previous}`);
    } else {
      seenScopes.set(scope, relative);
    }
  }
}

if (projectFiles.length === 0) {
  failures.push("No Nx project.json files were discovered.");
}

if (failures.length > 0) {
  console.error("NX_PROJECT_TAGS=FAIL");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`NX_PROJECT_TAGS=PASS projects=${projectFiles.length}`);
