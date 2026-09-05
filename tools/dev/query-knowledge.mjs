import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
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

const [kind, rawId] = process.argv.slice(2);

function usage(exitCode = 1) {
  console.error("Usage:");
  console.error("  node tools/dev/query-knowledge.mjs list capabilities");
  console.error("  node tools/dev/query-knowledge.mjs list journeys");
  console.error("  node tools/dev/query-knowledge.mjs capability <CAPABILITY_ID>");
  console.error("  node tools/dev/query-knowledge.mjs journey <J1|J2|...>");
  process.exit(exitCode);
}

if (!kind) usage();

const capabilityBody = () => read("governance/product/CAPABILITIES.md");
const journeyBody = () => read("governance/product/JOURNEYS.md");

if (kind === "list") {
  if (rawId === "capabilities") {
    const values = sections(capabilityBody(), /^###\s+([A-Z0-9_]+)\b.*$/gm);
    for (const value of values) console.log(value.id);
    process.exit(0);
  }
  if (rawId === "journeys") {
    const values = sections(journeyBody(), /^##\s+(J\d+)\s+—.*$/gm);
    for (const value of values) console.log(value.id + "\t" + value.title);
    process.exit(0);
  }
  usage();
}

if (!rawId) usage();

if (kind === "capability") {
  const wanted = rawId.toUpperCase();
  const values = sections(capabilityBody(), /^###\s+([A-Z0-9_]+)\b.*$/gm);
  const value = values.find((item) => item.id === wanted);
  if (!value) {
    console.error("UNKNOWN_CAPABILITY_ID=" + wanted);
    process.exit(2);
  }
  console.log("SOURCE=governance/product/CAPABILITIES.md");
  console.log("SEMANTIC_OWNER=governance/product/CAPABILITIES.md#" + wanted.toLowerCase().replaceAll("_", "-"));
  console.log("");
  console.log(value.body);
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
