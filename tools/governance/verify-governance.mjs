#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Deterministic integrity only. Semantic guard weakening requires independent review.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
	process.argv[2] === "--root"
		? process.argv[3]
		: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const at = (p) => path.join(root, ...p.split("/"));
const get = (p) => fs.readFileSync(at(p), "utf8");
function fail(s) {
	throw Error("GOVERNANCE_INTEGRITY_FAIL: " + s);
}
function git(args, input) {
	const p = spawnSync("git", args, { cwd: root, input, encoding: "utf8" });
	if (p.status !== 0) fail("git " + args.join(" ") + ": " + p.stderr);
	return p.stdout.trim();
}
const owners = [
	"AGENTS.md",
	"README.md",
	"REPOSITORY-STRUCTURE.md",
	"SECURITY.md",
	".github/pull_request_template.md",
	"docs/governance/README.md",
	"docs/governance/platform.md",
	"docs/governance/architecture.md",
	"docs/governance/product/overview.md",
	"docs/governance/product/capabilities.md",
	"docs/governance/product/journeys.md",
	"docs/governance/policies/security.md",
	"docs/governance/policies/data.md",
	"docs/governance/policies/finance.md",
	"docs/governance/policies/experience.md",
	"docs/governance/policies/design.md",
	"apps/control-panel/DESIGN.md",
	"apps/control-panel/UX-CONTRACT.md",
	"packages/design-system/README.md",
];
for (const p of owners)
	if (!fs.existsSync(at(p)) || !fs.lstatSync(at(p)).isFile())
		fail("canonical owner missing " + p);
if (fs.existsSync(at("knowledge.sources.json")))
	fail("external donor pin resurrected");
const law = get("AGENTS.md");
for (const x of [
	"## 1. Authority and exact state",
	"## 4. Local development state",
	"Professional product closure",
	"## 6. Consequential action safety",
	"## 8. Closure",
	"docs/governance/README.md",
])
	if (!law.includes(x)) fail("agent rule lost " + x);
if (
	!get("README.md").includes("docs/governance/README.md") ||
	!get("SECURITY.md").includes("docs/governance/policies/security.md")
)
	fail("local ownership routing broken");
if (
	!get("docs/governance/README.md").includes(
		"docs/governance/product/overview.md",
	) ||
	!get("docs/governance/README.md").includes("docs/governance/architecture.md")
)
	fail("durable owner router incomplete");
function walk(d, r = "") {
	if (!fs.existsSync(d)) return [];
	return fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => {
		if ([".git", "node_modules", ".nx", ".next"].includes(x.name)) return [];
		const q = r ? r + "/" + x.name : x.name;
		return x.isDirectory() ? walk(path.join(d, x.name), q) : [q];
	});
}
const paths = walk(root);
const oldRepo = ["bthwani2-boop/governance", "and-docs"].join("-"),
	oldSha = ["GOVERNANCE", "CANONICAL", "SHA"].join("_");
for (const p of paths) {
	if (p.startsWith("tools/governance/")) continue;
	if (!/\.(md|mdx|mjs|js|cjs|ts|tsx|json|jsonc|yml|yaml|ps1|psm1)$/.test(p))
		continue;
	const s = get(p);
	if (
		s.includes(oldRepo) ||
		s.includes(oldSha) ||
		s.includes("knowledge.sources.json") ||
		/(?<!docs\/)governance\/polic(?:y|ies)\//.test(s)
	)
		fail("obsolete donor authority in " + p);
	if (
		(p.startsWith("docs/governance/") || owners.includes(p)) &&
		p.endsWith(".md")
	) {
		const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
		for (const m of s.matchAll(re)) {
			const link = m[1];
			if (/^(https?:|mailto:|#|data:)/i.test(link)) continue;
			const dest = decodeURI(link.split("#")[0].split("?")[0]);
			if (!dest) continue;
			const target = path.resolve(path.dirname(at(p)), dest);
			if (!target.startsWith(root + path.sep) || !fs.existsSync(target))
				fail("broken/escaping link " + p + " -> " + link);
		}
	}
}
const manifest = {
	"README.md": "1ee645e386ce373a015f73e0a4bed6f78c78794a",
	"etlobni.md": "04739bee7334f85108c7859c1a94c7714aad714d",
	"hungerstation.md": "3a186568cbc941aff480fa33dadf27854fc425e7",
	"nass.md": "0b980387e6f3f4e9d599d27167b89644c30eef59",
	"tasaheel.md": "b5315d539415b2804d66737f6ab3253fa6f80f39",
	"tawseel-one.md": "d9e69f9d1762d8f97aa2fb4dee44d671be14c9c8",
};
const dir = at("docs/reference/competitors");
if (!fs.existsSync(dir)) fail("research directory missing");
const names = fs.readdirSync(dir).sort(),
	expected = Object.keys(manifest).sort();
if (JSON.stringify(names) !== JSON.stringify(expected))
	fail("research file set differs");
const rows = [];
for (const n of names) {
	const p = path.join(dir, n),
		stat = fs.lstatSync(p);
	if (!stat.isFile() || stat.isSymbolicLink())
		fail("research mode mismatch " + n);
	const blob = git(["hash-object", "--no-filters", p]);
	if (blob !== manifest[n]) fail("research blob differs " + n);
	rows.push("100644 blob " + blob + "\t" + n);
}
const tree = git(["mktree", "--missing"], rows.join("\n") + "\n");
if (tree !== "c9e63f530dd92f2a45bd60af6b24b4c868861c47")
	fail("research tree differs " + tree);
console.log(
	"GOVERNANCE_INTEGRITY_PASS tree=" + tree + " inspected=" + paths.length,
);
