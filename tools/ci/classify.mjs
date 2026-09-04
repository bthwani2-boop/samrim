import {execFileSync} from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const get = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const head = get("head");
let base = get("base") ?? "";
if (!head || !/^[0-9a-f]{40}$/.test(head)) throw new Error("--head must be a 40-character SHA");
const validBase = /^[0-9a-f]{40}$/.test(base) && !/^0+$/.test(base);
let changed = [];
try {
  if (validBase) changed = execFileSync("git", ["diff","--name-only",`${base}...${head}`], {encoding:"utf8"}).split(/\r?\n/).filter(Boolean);
  else { changed = execFileSync("git", ["show","--pretty=","--name-only",head], {encoding:"utf8"}).split(/\r?\n/).filter(Boolean); base = ""; }
} catch {
  changed = execFileSync("git", ["ls-tree","-r","--name-only",head], {encoding:"utf8"}).split(/\r?\n/).filter(Boolean); base = "";
}
const any = (patterns) => changed.some(file => patterns.some(rx => rx.test(file)));
const claims = {
  repository_policy: true,
  secrets: changed.length > 0,
  workflow_integrity: any([/^\.github\//,/^tools\/ci\//]),
  dependencies: any([/(^|\/)(package\.json|pnpm-lock\.yaml|go\.mod|go\.sum)$/]),
  containers: any([/(^|\/)Dockerfile(?:\..*)?$/,/docker-compose.*\.ya?ml$/,/^infra\//]),
  typescript: any([/\.(ts|tsx|js|jsx|mjs|cjs)$/]),
  go: any([/\.go$/,/(^|\/)go\.(mod|sum)$/]),
  contracts: any([/^contracts\//,/openapi/i]),
  runtime: any([/^services\//,/^infra\//]),
  ui: any([/^apps\//,/control-panel/i]),
  performance: any([/^performance\//,/k6/i])
};
const highRisk = any([/^\.github\//,/^governance\//,/^contracts\//,/^infra\//,/(^|\/)(auth|security|wlt|wallet|payments?|migrations?)(\/|$)/i]);
const result = {schema_version:1,candidate_sha:head,base_sha:base,changed_files:changed,high_risk:highRisk,claims};
fs.mkdirSync(".ci-evidence",{recursive:true});
fs.writeFileSync(".ci-evidence/classification.json",JSON.stringify(result,null,2)+"\n");
if (process.env.GITHUB_OUTPUT) {
  for (const [k,v] of Object.entries(claims)) fs.appendFileSync(process.env.GITHUB_OUTPUT,`${k}=${v}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`high_risk=${highRisk}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const active = Object.entries(claims).filter(([,v])=>v).map(([k])=>k).join(", ");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Semantic classification\n\n- High risk: **${highRisk}**\n- Active claims: ${active}\n- Changed files: ${changed.length}\n\n`);
}
console.log(JSON.stringify(result));
