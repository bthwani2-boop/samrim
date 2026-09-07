import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out;
}

function rootForFile(file) {
  return file.startsWith(knowledgeRoot + path.sep) ? knowledgeRoot : repoRoot;
}

function logicalRelative(file) {
  return path.relative(rootForFile(file), file).split(path.sep).join("/");
}

function rootForLogicalPath(ref) {
  return ref.startsWith("governance/") || ref.startsWith("docs/")
    ? knowledgeRoot
    : repoRoot;
}

function extractKnowledgeRefs(body) {
  const refs = [];
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    refs.push(match[1].trim());
  }
  for (const match of body.matchAll(/`([^`\n]+\.md(?:#[^`]*)?)`/g)) {
    refs.push(match[1].trim());
  }
  return refs;
}

function resolveKnowledgeRef(sourceFile, raw) {
  let ref = raw.trim().replace(/^<|>$/g, "");
  if (!ref) return null;
  if (/^(https?:|mailto:|tel:)/i.test(ref)) return null;
  if (ref.startsWith("#")) return null;
  if (/[<>{}*]/.test(ref) || ref.includes("...")) return null;

  ref = ref.split("#", 1)[0].split("?", 1)[0].replaceAll("\\", "/");
  if (!ref || !ref.endsWith(".md")) return null;

  const rootRelativePrefixes = [
    "governance/",
    "docs/",
    "tools/",
    ".github/",
  ];
  const rootFiles = new Set([
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
  ]);

  let absolute;
  let owningRoot;
  if (rootRelativePrefixes.some((prefix) => ref.startsWith(prefix)) || rootFiles.has(ref)) {
    owningRoot = rootForLogicalPath(ref);
    absolute = path.join(owningRoot, ...ref.split("/"));
  } else if (ref.startsWith("/")) {
    const stripped = ref.slice(1);
    owningRoot = rootForLogicalPath(stripped);
    absolute = path.join(owningRoot, ...stripped.split("/"));
  } else {
    owningRoot = rootForFile(sourceFile);
    absolute = path.resolve(path.dirname(sourceFile), ref);
  }

  const relative = path.relative(owningRoot, absolute).split(path.sep).join("/");
  if (relative.startsWith("../") || relative === "..") {
    return { invalidEscape: true, relative };
  }
  return { absolute, relative };
}

const sources = [
  ...collectMarkdown(path.join(knowledgeRoot, "governance")),
  ...collectMarkdown(path.join(knowledgeRoot, "docs")),
];

for (const rootFile of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md", "CONTRIBUTING.md"]) {
  const absolute = path.join(repoRoot, rootFile);
  if (fs.existsSync(absolute)) sources.push(absolute);
}

const failures = [];
const docsInbound = new Map();

for (const source of sources) {
  const sourceRel = logicalRelative(source);
  const body = fs.readFileSync(source, "utf8");

  for (const raw of extractKnowledgeRefs(sourceRel === "docs/reference/donor.md" ? body.replace(/`[^`]*`/g, "") : body)) {
    const resolved = resolveKnowledgeRef(source, raw);
    if (!resolved) continue;

    if (resolved.invalidEscape) {
      failures.push(sourceRel + " reference escapes its authority root: " + raw);
      continue;
    }

    if (!fs.existsSync(resolved.absolute) || !fs.statSync(resolved.absolute).isFile()) {
      failures.push(
        sourceRel + " has broken Markdown reference: " + raw + " -> " + resolved.relative,
      );
      continue;
    }

    if (
      resolved.relative.startsWith("docs/") &&
      resolved.relative.endsWith(".md") &&
      resolved.relative !== sourceRel
    ) {
      docsInbound.set(
        resolved.relative,
        (docsInbound.get(resolved.relative) ?? 0) + 1,
      );
    }
  }
}

const orphanScopes = [
  path.join(knowledgeRoot, "docs/method"),
  path.join(knowledgeRoot, "docs/development"),
  path.join(knowledgeRoot, "docs/runbooks"),
  path.join(knowledgeRoot, "docs/reference"),
];

for (const file of orphanScopes.flatMap(collectMarkdown)) {
  const rel = logicalRelative(file);
  if (path.basename(file).toLowerCase() === "readme.md") continue;
  if ((docsInbound.get(rel) ?? 0) === 0) {
    failures.push(
      "orphaned knowledge document with no inbound Markdown/backtick reference: " + rel,
    );
  }
}

const donorReference = "docs/reference/donor.md";
const donorAbsolute = path.join(knowledgeRoot, ...donorReference.split("/"));
if (fs.existsSync(donorAbsolute) && (docsInbound.get(donorReference) ?? 0) === 0) {
  failures.push("donor reconstruction reference is orphaned: " + donorReference);
}

if (failures.length) {
  console.error("KNOWLEDGE_REFERENCE_VERIFY=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

console.log("KNOWLEDGE_REFERENCE_VERIFY=PASS");
console.log("MARKDOWN_SOURCES=" + sources.length);
console.log("DOC_TARGETS_WITH_INBOUND_REFS=" + docsInbound.size);
