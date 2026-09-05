import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function collectMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out;
}

function governanceOwners() {
  const governanceRoot = path.join(root, "governance");
  const owners = [];
  for (const absolute of collectMarkdown(governanceRoot)) {
    const body = fs.readFileSync(absolute, "utf8");
    const ownerMatch = body.match(/^SEMANTIC_OWNER:\s*(\S+)\s*$/m);
    if (!ownerMatch) continue;
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const artifactMatch = body.match(/^ARTIFACT_CLASS:\s*(\S+)\s*$/m);
    owners.push({
      owner: ownerMatch[1],
      title: titleMatch?.[1]?.trim() ?? "",
      artifactClass: artifactMatch?.[1]?.trim() ?? "",
    });
  }
  return owners.sort((a, b) => a.owner.localeCompare(b.owner));
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

const [kind, ...args] = process.argv.slice(2);
const rawId = args.join(" ").trim();

function usage(exitCode = 1) {
  console.error("Usage:");
  console.error("  node tools/dev/query-knowledge.mjs list capabilities");
  console.error("  node tools/dev/query-knowledge.mjs list journeys");
  console.error("  node tools/dev/query-knowledge.mjs list owners");
  console.error("  node tools/dev/query-knowledge.mjs capability <CAPABILITY_ID>");
  console.error("  node tools/dev/query-knowledge.mjs journey <J1|J2|...>");
  console.error("  node tools/dev/query-knowledge.mjs owner <keyword-or-path>");
  process.exit(exitCode);
}

if (!kind) usage();

function capabilityRecords() {
  const capabilityRoot = path.join(root, "governance/product/capabilities");
  const out = [];
  for (const absolute of collectMarkdown(capabilityRoot)) {
    const body = fs.readFileSync(absolute, "utf8");
    const rel = path.relative(root, absolute).split(path.sep).join("/");
    const owner = body.match(/^SEMANTIC_OWNER:\s*(\S+)\s*$/m)?.[1] ?? rel;
    for (const section of sections(body, /^###\s+([A-Z0-9_]+)\b.*$/gm)) {
      out.push({ ...section, source: rel, owner });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const journeyBody = () => read("governance/product/JOURNEYS.md");

if (kind === "list") {
  if (rawId === "capabilities") {
    for (const value of capabilityRecords()) console.log(value.id);
    process.exit(0);
  }
  if (rawId === "journeys") {
    const values = sections(journeyBody(), /^##\s+(J\d+)\s+—.*$/gm);
    for (const value of values) console.log(value.id + "\t" + value.title);
    process.exit(0);
  }
  if (rawId === "owners") {
    for (const value of governanceOwners()) {
      console.log(value.owner + "\t" + value.title + "\t" + value.artifactClass);
    }
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
  console.log("SEMANTIC_OWNER=" + value.owner + "#" + wanted.toLowerCase().replaceAll("_", "-"));
  console.log("");
  console.log(value.body);
  process.exit(0);
}

if (kind === "owner") {
  if (!rawId) usage();
  const query = rawId.toLowerCase();
  const values = governanceOwners().filter((item) =>
    item.owner.toLowerCase().includes(query) ||
    item.title.toLowerCase().includes(query) ||
    item.artifactClass.toLowerCase().includes(query)
  );
  if (!values.length) {
    console.error("UNKNOWN_SEMANTIC_OWNER_QUERY=" + rawId);
    process.exit(2);
  }
  for (const value of values) {
    console.log(value.owner + "\t" + value.title + "\t" + value.artifactClass);
  }
  process.exit(0);
}

if (kind === "journey") {
  const wanted = rawId.toUpperCase();
  const values = sections(journeyBody(), /^##\s+(J\d+)\s+—.*$/gm);
  const value = values.find((item) => item.id === wanted);
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

usage();
