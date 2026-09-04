import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const get = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const root = get("root") ?? ".closure-evidence";
const candidate = get("candidate");
const required = (get("require") ?? "").split(",").map(v => v.trim()).filter(Boolean);
if (!candidate || !/^[0-9a-f]{40}$/.test(candidate)) throw new Error("A 40-character --candidate SHA is required");
if (!required.length) throw new Error("At least one required claim is required");

const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && e.name.endsWith(".json")) files.push(full);
  }
};
walk(root);
const byClaim = new Map();
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.claim_id) continue;
  if (byClaim.has(data.claim_id)) throw new Error(`Duplicate evidence for ${data.claim_id}`);
  byClaim.set(data.claim_id, data);
}
const failures = [];
for (const claim of required) {
  const e = byClaim.get(claim);
  if (!e) { failures.push(`${claim}: missing evidence`); continue; }
  if (e.candidate_sha !== candidate) failures.push(`${claim}: wrong candidate SHA ${e.candidate_sha}`);
  if (e.status !== "PASS") failures.push(`${claim}: status=${e.status}`);
  if (e.report_valid !== true || !e.report_digest) failures.push(`${claim}: invalid/missing report evidence`);
}
const summary = ["# Promotion closure evidence","",`Candidate: \`${candidate}\``,"",
  ...required.map(c => `- ${c}: ${byClaim.get(c)?.status ?? "MISSING"}`),""].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
