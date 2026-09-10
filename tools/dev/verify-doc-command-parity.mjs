import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const docsRoot = path.join(knowledgeRoot, "docs");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const scripts = new Set(Object.keys(packageJson.scripts ?? {}));

const pnpmBuiltins = new Set([
  "add",
  "config",
  "create",
  "deploy",
  "dlx",
  "env",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "list",
  "ls",
  "pack",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "setup",
  "store",
  "update",
  "up",
  "why",
]);

const forbiddenLegacyPatterns = [
  { label: "legacy mobile wrapper", regex: /tools\/mobile\/mobile\.ps1/i },
  { label: "legacy app runtime wrapper wording", regex: /app runtime wrappers?/i },
  { label: "stale LeanCTX repository policy path", regex: /\.agents\/tools\/leanctx\.md/i },
  { label: "stale LeanCTX adapter path", regex: /\bLEAN-CTX\.md\b/i },
  { label: "stale agent routing index", regex: /\.agents\/INDEX\.md/i },
  { label: "stale LeanCTX tracked config", regex: /\.lean-ctx(?:\.toml|-id)\b/i },
  { label: "donor-specific reference pin", regex: /PIN_LIVE_h/i },
  { label: "legacy full runtime command", regex: /runtime:full(?::smoke)?/i },
  { label: "legacy foundation runtime command", regex: /\b(?:foundation:|runtime:foundation:)\S*/i },
  {
    label: "legacy foundation compose profile",
    regex: new RegExp("--pro" + "file\\s+foundation\\b", "i"),
  },
  { label: "legacy verify full command", regex: /verify:full/i },
  { label: "legacy reverse wrapper", regex: /\bpnpm\s+reverse\b/i },
  { label: "legacy mobile eas wrapper", regex: /\bpnpm\s+mobile:eas\b/i },
  {
    label: "donor repository path",
    regex: new RegExp("bthwani-suite" + "-next", "i"),
  },
  {
    label: "donor branch authority",
    regex: new RegExp("\\borigin" + "\\/h\\b", "i"),
  },
  {
    label: "wrong diagnosis-plan authority",
    regex: /plans\/diagnose-implementing/i,
  },
];

function collectMarkdownFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

function displayPath(file) {
  const knowledgeRel = path.relative(knowledgeRoot, file);
  if (!knowledgeRel.startsWith("..") && !path.isAbsolute(knowledgeRel)) {
    return "knowledge:" + knowledgeRel.replaceAll("\\", "/");
  }
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function resolveRepositoryPath(candidate) {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("governance/") || normalized.startsWith("docs/")) {
    return path.join(knowledgeRoot, ...normalized.split("/"));
  }
  return path.join(repoRoot, ...normalized.split("/"));
}

const failures = [];
const nonAuthoritativeCommandDrift = [];
const documentationFiles = [
  ...collectMarkdownFiles(docsRoot),
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "CONTRIBUTING.md"),
  path.join(repoRoot, "AGENTS.md"),
  path.join(repoRoot, "SECURITY.md"),
  path.join(repoRoot, "tools", "README.md"),
].filter((file, index, all) => fs.existsSync(file) && all.indexOf(file) === index);

for (const file of documentationFiles) {
  const relative = displayPath(file);
  const body = fs.readFileSync(file, "utf8");
  const lines = body.split("\n");
  const executionAuthorityNone = relative.startsWith("knowledge:") && /(?:^|\n)EXECUTION_AUTHORITY:\s*NONE\s*(?:\n|$)/.test(body);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const pattern of forbiddenLegacyPatterns) {
      if (pattern.regex.test(line)) {
        failures.push(
          relative + ":" + lineNumber + " -> " + pattern.label + ": " + line.trim(),
        );
      }
    }

    if (relative !== "knowledge:docs/reference/donor.md") {
      for (const codeMatch of line.matchAll(/`([^`]+)`/g)) {
        const code = codeMatch[1];
        for (const match of code.matchAll(
          /\b(?:governance|docs|tools|apps|services|packages|infra)\/[A-Za-z0-9._@+\/-]+/g,
        )) {
          const candidate = match[0].replace(/[.,;:]+$/, "").replace(/\/$/, "");
          if (!candidate || /[*{}<>]/.test(candidate)) continue;
          const absolute = resolveRepositoryPath(candidate);
          if (!fs.existsSync(absolute)) {
            failures.push(
              relative + ":" + lineNumber +
                " -> missing referenced path: " + candidate,
            );
          }
        }
      }
    }

    if (/\bpnpm\s+--dir\b/.test(line)) return;

    for (const match of line.matchAll(
      /\bpnpm\s+(?:run\s+)?([A-Za-z0-9][A-Za-z0-9:_-]*)/g,
    )) {
      const command = match[1];
      if (pnpmBuiltins.has(command)) continue;
      if (!scripts.has(command)) {
        const finding = relative + ":" + lineNumber +
          " -> command not present in current repository: pnpm " + command;
        if (executionAuthorityNone) {
          nonAuthoritativeCommandDrift.push(finding);
        } else {
          failures.push(finding);
        }
      }
    }
  });
}

if (failures.length > 0) {
  console.error("DOC_COMMAND_PARITY=FAIL");
  for (const failure of [...new Set(failures)].sort()) {
    console.error("  " + failure);
  }
  process.exit(1);
}

for (const drift of [...new Set(nonAuthoritativeCommandDrift)].sort()) {
  console.warn("DOC_NONAUTHORITATIVE_COMMAND_DRIFT " + drift);
}
console.log("DOC_COMMAND_PARITY=PASS");
console.log("DOC_NONAUTHORITATIVE_COMMAND_DRIFT_COUNT=" + new Set(nonAuthoritativeCommandDrift).size);
