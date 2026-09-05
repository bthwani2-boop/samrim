import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

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

function repoRelative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function extractKnowledgeRefs(body) {
  const refs = [];

  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    refs.push(match[1].trim());
  }

  for (const match of body.matchAll(/\`([^\`\n]+\.md(?:#[^\`]*)?)\`/g)) {
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
  if (rootRelativePrefixes.some((prefix) => ref.startsWith(prefix)) || rootFiles.has(ref)) {
    absolute = path.join(root, ref);
  } else if (ref.startsWith("/")) {
    absolute = path.join(root, ref.slice(1));
  } else {
    absolute = path.resolve(path.dirname(sourceFile), ref);
  }

  const relative = repoRelative(absolute);
  if (relative.startsWith("../") || relative === "..") return { invalidEscape: true, relative };
  return { absolute, relative };
}

const scopes = [
  path.join(root, "governance"),
  path.join(root, "docs"),
  path.join(root, "tools/prompting"),
];

const sources = scopes.flatMap(collectMarkdown);
for (const rootFile of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md", "CONTRIBUTING.md"]) {
  const absolute = path.join(root, rootFile);
  if (fs.existsSync(absolute)) sources.push(absolute);
}

const failures = [];
const docsInbound = new Map();

for (const source of sources) {
  const sourceRel = repoRelative(source);
  const body = fs.readFileSync(source, "utf8");

  for (const raw of extractKnowledgeRefs(body)) {
    const resolved = resolveKnowledgeRef(source, raw);
    if (!resolved) continue;

    if (resolved.invalidEscape) {
      failures.push(sourceRel + " reference escapes repository: " + raw);
      continue;
    }

    if (!fs.existsSync(resolved.absolute) || !fs.statSync(resolved.absolute).isFile()) {
      failures.push(sourceRel + " has broken internal Markdown reference: " + raw + " -> " + resolved.relative);
      continue;
    }

    if (resolved.relative.startsWith("docs/") && resolved.relative.endsWith(".md") && resolved.relative !== sourceRel) {
      docsInbound.set(resolved.relative, (docsInbound.get(resolved.relative) ?? 0) + 1);
    }
  }
}

const orphanScopes = [
  path.join(root, "docs/development"),
  path.join(root, "docs/platform-engineering-lifecycle"),
  path.join(root, "docs/runbooks"),
  path.join(root, "docs/reference/external-systems"),
];

for (const file of orphanScopes.flatMap(collectMarkdown)) {
  const rel = repoRelative(file);
  if (path.basename(file).toLowerCase() === "readme.md") continue;
  if ((docsInbound.get(rel) ?? 0) === 0) {
    failures.push("orphaned knowledge document with no inbound Markdown/backtick reference: " + rel);
  }
}

const donorReference = "docs/reference/donor-reconstruction-patterns.md";
if (fs.existsSync(path.join(root, donorReference)) && (docsInbound.get(donorReference) ?? 0) === 0) {
  failures.push("donor reconstruction reference is orphaned: " + donorReference);
}

if (failures.length) {
  console.error("KNOWLEDGE_REFERENCE_VERIFY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("KNOWLEDGE_REFERENCE_VERIFY=PASS");
console.log("MARKDOWN_SOURCES=" + sources.length);
console.log("DOC_TARGETS_WITH_INBOUND_REFS=" + docsInbound.size);
