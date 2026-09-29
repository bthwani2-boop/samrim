import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const root = ensureKnowledgeRoot({ materialize: true });
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");

function read(relativePath) {
  return fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
}

function lines(body) {
  return body.split(/\r?\n/);
}

function metadataValue(body, key) {
  const prefix = `${key}:`;
  const line = lines(body).find((value) => value.startsWith(prefix));
  if (!line) return "";
  return line.slice(prefix.length).trim().split(/\s+/)[0] ?? "";
}

function metadataValues(body, key) {
  const prefix = `${key}:`;
  return lines(body)
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length).trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function firstHeadingTitle(body) {
  const line = lines(body).find((value) => value.startsWith("# "));
  return line ? line.slice(2).trim() : "";
}

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out.toSorted(compareStrings);
}

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function sections(body, headingRe, idIndex = 1) {
  const matches = [...body.matchAll(headingRe)];
  return matches.map((match, index) => ({
    id: match[idIndex],
    title: match[0].replace(/^#+\s+/, ""),
    body: body.slice(
      match.index,
      index + 1 < matches.length ? matches[index + 1].index : body.length,
    ).trimEnd(),
  }));
}

function governanceOwners() {
  const governanceRoot = path.join(root, "governance");
  const owners = [];
  for (const absolute of collectMarkdown(governanceRoot)) {
    const body = fs.readFileSync(absolute, "utf8");
    const owner = metadataValue(body, "SEMANTIC_OWNER");
    if (!owner) continue;
    owners.push({
      owner,
      source: relative(absolute),
      title: firstHeadingTitle(body),
      artifactClass: metadataValue(body, "ARTIFACT_CLASS"),
    });
  }
  return owners.toSorted((a, b) => compareStrings(a.owner, b.owner));
}

function capabilityRecords() {
  const capabilityRoot = path.join(root, "governance/product/capabilities");
  const out = [];
  for (const absolute of collectMarkdown(capabilityRoot)) {
    const body = fs.readFileSync(absolute, "utf8");
    const id = metadataValue(body, "CAPABILITY_ID");
    if (!/^[A-Z0-9_]+$/.test(id)) continue;
    out.push({
      id,
      source: relative(absolute),
      owner: metadataValue(body, "SEMANTIC_OWNER") || relative(absolute),
      body,
    });
  }
  return out.toSorted((a, b) => compareStrings(a.id, b.id));
}

function referenceRecords() {
  const referenceRoot = path.join(root, "docs/reference");
  return collectMarkdown(referenceRoot).map((absolute) => {
    const body = fs.readFileSync(absolute, "utf8");
    return {
      source: relative(absolute),
      title: firstHeadingTitle(body),
      referenceClass: metadataValue(body, "REFERENCE_CLASS"),
      body,
    };
  }).toSorted((a, b) => compareStrings(a.source, b.source));
}

function policyRecords() {
  const policyRoot = path.join(root, "governance/policy");
  return collectMarkdown(policyRoot).map((absolute) => {
    const body = fs.readFileSync(absolute, "utf8");
    return {
      source: relative(absolute),
      title: firstHeadingTitle(body),
      owner: metadataValue(body, "SEMANTIC_OWNER"),
      body,
    };
  }).toSorted((a, b) => compareStrings(a.source, b.source));
}

function qualityDimensions() {
  return metadataValues(read("governance/policy/QUALITY.md"), "QUALITY_DIMENSION")
    .filter((value) => /^[A-Z0-9_]+$/.test(value));
}

const journeyBody = () => read("governance/product/JOURNEYS.md");
const [kind, ...args] = process.argv.slice(2);
const rawId = args.join(" ").trim();

function usage(exitCode = 1) {
  console.error("Usage:");
  console.error("  node tools/dev/query-knowledge.mjs list capabilities|journeys|owners|policies|references|quality-dimensions");
  console.error("  node tools/dev/query-knowledge.mjs meta-standard");
  console.error("  node tools/dev/query-knowledge.mjs capability <CAPABILITY_ID>");
  console.error("  node tools/dev/query-knowledge.mjs journey <J0|J1|...>");
  console.error("  node tools/dev/query-knowledge.mjs owner <keyword-or-path>");
  console.error("  node tools/dev/query-knowledge.mjs policy <keyword-or-path>");
  console.error("  node tools/dev/query-knowledge.mjs reference <keyword-or-class-or-path>");
  process.exit(exitCode);
}

if (!kind) usage();

if (kind === "meta-standard") {
  console.log("SOURCE=GOVERNANCE-STANDARDS.md");
  console.log("SEMANTIC_AUTHORITY=NONE");
  console.log("");
  console.log(read("GOVERNANCE-STANDARDS.md"));
  process.exit(0);
}

if (kind === "list") {
  if (rawId === "capabilities") {
    for (const value of capabilityRecords()) console.log(value.id);
    process.exit(0);
  }
  if (rawId === "journeys") {
    for (const value of sections(journeyBody(), /^##\s+(J\d+)\s+—.*$/gm)) console.log(value.id + "\t" + value.title);
    process.exit(0);
  }
  if (rawId === "owners") {
    for (const value of governanceOwners()) console.log(value.owner + "\t" + value.title + "\t" + value.artifactClass);
    process.exit(0);
  }
  if (rawId === "policies") {
    for (const value of policyRecords()) console.log(value.owner + "\t" + value.title);
    process.exit(0);
  }
  if (rawId === "references") {
    for (const value of referenceRecords()) console.log(value.referenceClass + "\t" + value.source + "\t" + value.title);
    process.exit(0);
  }
  if (rawId === "quality-dimensions") {
    for (const value of qualityDimensions()) console.log(value);
    process.exit(0);
  }
  usage();
}

if (!rawId) usage();

if (kind === "capability") {
  const wanted = rawId.toUpperCase();
  const value = capabilityRecords().find((item) => item.id === wanted);
  if (!value) {
    console.error("UNKNOWN_CAPABILITY_ID=" + wanted);
    process.exit(2);
  }
  console.log("SOURCE=" + value.source);
  console.log("SEMANTIC_OWNER=" + value.owner);
  console.log("");
  console.log(value.body);
  process.exit(0);
}

if (kind === "journey") {
  const wanted = rawId.toUpperCase();
  const value = sections(journeyBody(), /^##\s+(J\d+)\s+—.*$/gm).find((item) => item.id === wanted);
  if (!value) {
    console.error("UNKNOWN_JOURNEY_ID=" + wanted);
    process.exit(2);
  }
  console.log("SOURCE=governance/product/JOURNEYS.md");
  console.log("SEMANTIC_OWNER=governance/product/JOURNEYS.md#" + wanted.toLowerCase());
  console.log("");
  console.log(value.body);
  process.exit(0);
}

if (kind === "owner") {
  const query = rawId.toLowerCase();
  const values = governanceOwners().filter((item) =>
    item.owner.toLowerCase().includes(query) ||
    item.source.toLowerCase().includes(query) ||
    item.title.toLowerCase().includes(query) ||
    item.artifactClass.toLowerCase().includes(query)
  );
  if (!values.length) {
    console.error("UNKNOWN_SEMANTIC_OWNER_QUERY=" + rawId);
    process.exit(2);
  }
  for (const value of values) console.log(value.owner + "\t" + value.title + "\t" + value.artifactClass);
  process.exit(0);
}

if (kind === "policy") {
  const wanted = rawId.toLowerCase();
  const values = policyRecords().filter((item) =>
    item.owner.toLowerCase().includes(wanted) ||
    item.source.toLowerCase().includes(wanted) ||
    item.title.toLowerCase().includes(wanted)
  );
  if (!values.length) {
    console.error("UNKNOWN_POLICY_QUERY=" + rawId);
    process.exit(2);
  }
  for (const value of values) {
    console.log("SOURCE=" + value.source);
    console.log("SEMANTIC_OWNER=" + value.owner);
    console.log("");
    console.log(value.body);
    if (values.length > 1) console.log("\n---\n");
  }
  process.exit(0);
}

if (kind === "reference") {
  const query = rawId.toLowerCase();
  const values = referenceRecords().filter((item) =>
    item.referenceClass.toLowerCase().includes(query) ||
    item.source.toLowerCase().includes(query) ||
    item.title.toLowerCase().includes(query)
  );
  if (!values.length) {
    console.error("UNKNOWN_REFERENCE_QUERY=" + rawId);
    process.exit(2);
  }
  for (const value of values) {
    console.log("SOURCE=" + value.source);
    console.log("REFERENCE_CLASS=" + value.referenceClass);
    console.log("");
    console.log(value.body);
    if (values.length > 1) console.log("\n---\n");
  }
  process.exit(0);
}

usage();
