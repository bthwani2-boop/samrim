import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ensureKnowledgeRoot,
  readKnowledgePin,
  readKnowledgeSources,
} from "./knowledge-source.mjs";

{
  const root = path.resolve(import.meta.dirname, "../..");
  const knowledgeRoot = ensureKnowledgeRoot({ materialize: false });
  const pin = readKnowledgePin();
  const sources = readKnowledgeSources();
  const failures = [];
  const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");

  function requireFile(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      failures.push(`missing repository-owned artifact: ${relative}`);
    }
  }

  for (const requiredPinned of [
    "GOVERNANCE-STANDARDS.md",
    "AGENTS.md",
    "governance/GOVERNANCE.md",
    "governance/policy/QUALITY.md",
    "tools/verify-knowledge.mjs",
  ]) {
    const absolute = path.join(knowledgeRoot, requiredPinned);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      failures.push(`pinned Governance missing required artifact: ${requiredPinned}`);
    }
  }

  const metaStandardPath = path.join(knowledgeRoot, "GOVERNANCE-STANDARDS.md");
  if (fs.existsSync(metaStandardPath)) {
    const meta = fs.readFileSync(metaStandardPath, "utf8");
    for (const token of [
      "ARTIFACT_CLASS: GOVERNANCE_AND_AGENT_META_STANDARD",
      "PROJECT_SEMANTIC_AUTHORITY: NONE",
      "EXECUTION_AUTHORITY: NONE",
    ]) {
      if (!meta.includes(token)) failures.push(`pinned meta-standard missing authority boundary: ${token}`);
    }
  }

  try {
    execFileSync(process.execPath, [path.join(knowledgeRoot, "tools", "verify-knowledge.mjs")], {
      cwd: knowledgeRoot,
      stdio: "inherit",
    });
  } catch {
    failures.push("pinned knowledge verifier failed");
  }

  for (const forbiddenRoot of ["governance", "docs", "tools/prompting"]) {
    if (fs.existsSync(path.join(root, forbiddenRoot))) {
      failures.push(`forbidden local/retired authority root exists: ${forbiddenRoot}`);
    }
  }

  if (fs.existsSync(path.join(root, "DESIGN.md"))) {
    failures.push("retired root DESIGN.md parallel design authority exists");
  }

  if (sources.schema !== 2) failures.push("knowledge manifest must use schema 2 immutable binding");
  if (pin.repository !== "bthwani2-boop/governance-and-docs") {
    failures.push(`unexpected knowledge repository: ${pin.repository}`);
  }
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push("knowledge pin is not an exact commit SHA");

  for (const forbidden of ["branch", "branch_url"]) {
    if (forbidden in sources.governance) {
      failures.push(`governance binding must not carry floating provenance field: ${forbidden}`);
    }
  }

  for (const required of [
    "AGENTS.md",
    "knowledge.sources.json",
    "tools/dev/safe-push.ps1",
    "tools/dev/verify-local-candidate.ps1",
    "tools/dev/knowledge-source.mjs",
    "tools/dev/query-knowledge.mjs",
    "tools/dev/verify-agent-knowledge-contract.mjs",
    "tools/dev/verify-knowledge.mjs",
    ".github/pull_request_template.md",
    ".github/workflows/ci-static.yml",
    ".github/workflows/ci-runtime.yml",
    ".github/workflows/ci-security.yml",
    ".github/workflows/ci-policy.yml",
  ]) {
    requireFile(required);
  }

  if (failures.length) {
    console.error("KNOWLEDGE_SYSTEM_VERIFY=FAIL");
    for (const failure of [...new Set(failures)].toSorted(compareStrings)) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log("KNOWLEDGE_SYSTEM_VERIFY=PASS");
  console.log(`KNOWLEDGE_REPOSITORY=${pin.repository}`);
  console.log(`KNOWLEDGE_COMMIT=${pin.commit}`);
  console.log("AGENT_LAW_OWNER=AGENTS.md");
  console.log("LOCAL_PROMPT_PACKAGE_ROOT=0");
  console.log("PINNED_GOVERNANCE_META_STANDARD=PASS");
}

{
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const knowledgeRoot = ensureKnowledgeRoot({ materialize: false });
  const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");

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
    return ref === "GOVERNANCE-STANDARDS.md" || ref.startsWith("governance/") || ref.startsWith("docs/")
      ? knowledgeRoot
      : repoRoot;
  }

  function markdownLinkTargets(body) {
    const refs = [];
    let cursor = 0;
    while (cursor < body.length) {
      const marker = body.indexOf("](", cursor);
      if (marker < 0) break;
      const openingBracket = body.lastIndexOf("[", marker);
      const closingParen = body.indexOf(")", marker + 2);
      if (openingBracket < 0 || closingParen < 0) {
        cursor = marker + 2;
        continue;
      }
      refs.push(body.slice(marker + 2, closingParen).trim());
      cursor = closingParen + 1;
    }
    return refs;
  }

  function extractKnowledgeRefs(body) {
    const refs = markdownLinkTargets(body);
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
    if (!ref?.endsWith(".md")) return null;

    const rootRelativePrefixes = [
      "governance/",
      "docs/",
      "tools/",
      ".github/",
    ];
    const rootFiles = new Set([
      "AGENTS.md",
      "GOVERNANCE-STANDARDS.md",
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
    path.join(knowledgeRoot, "GOVERNANCE-STANDARDS.md"),
    ...collectMarkdown(path.join(knowledgeRoot, "governance")),
    ...collectMarkdown(path.join(knowledgeRoot, "docs")),
  ].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());

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
    for (const failure of [...new Set(failures)].toSorted(compareStrings)) console.error("  " + failure);
    process.exit(1);
  }

  console.log("KNOWLEDGE_REFERENCE_VERIFY=PASS");
  console.log("MARKDOWN_SOURCES=" + sources.length);
  console.log("DOC_TARGETS_WITH_INBOUND_REFS=" + docsInbound.size);

}
