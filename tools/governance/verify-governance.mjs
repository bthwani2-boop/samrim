#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Deterministic integrity only. Semantic guard weakening requires independent review.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const root = path.resolve(
	process.argv[2] === "--root" ? process.argv[3] : repoRoot,
);
const isRepositoryRoot = (() => {
	try {
		const actualRoot = fs.realpathSync.native(root);
		const actualRepoRoot = fs.realpathSync.native(repoRoot);
		return process.platform === "win32"
			? actualRoot.toLowerCase() === actualRepoRoot.toLowerCase()
			: actualRoot === actualRepoRoot;
	} catch {
		return false;
	}
})();
const at = (p) => path.join(root, ...p.split("/"));
const get = (p) => fs.readFileSync(at(p), "utf8");
function fail(s) {
	throw Error("GOVERNANCE_INTEGRITY_FAIL: " + s);
}
function git(args, input) {
	const p = spawnSync("git", args, { cwd: root, input, encoding: "utf8" });
	if (p.status !== 0) fail("git " + args.join(" ") + ": " + p.stderr);
	return args.includes("-z") ? p.stdout : p.stdout.trim();
}
function resolveTrustedCommit() {
	let ref =
		isRepositoryRoot
			? "refs/remotes/origin/main"
			: process.env.GOVERNANCE_TRUSTED_REF || "refs/remotes/origin/main";
	if (isRepositoryRoot && process.env.GITHUB_EVENT_PATH) {
		let event;
		try {
			event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
		} catch {
			fail("unable to read GitHub event for trusted governance baseline");
		}
		const before = event.before;
		const validBefore =
			typeof before === "string" &&
			/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(before) &&
			!/^0+$/.test(before);
		ref =
			event.pull_request?.base?.sha ||
			(validBefore ? before : "refs/remotes/origin/main");
	}
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64}|refs\/remotes\/origin\/main)$/i.test(ref))
		fail("invalid trusted governance baseline reference");
	return git(["rev-parse", "--verify", ref + "^{commit}"]);
}
const trustedCommit = resolveTrustedCommit();
// Only stable entrypoints are fixed; owner documents are verified by declaration and routing.
const owners = [
  "AGENTS.md",
  "README.md",
  "REPOSITORY-STRUCTURE.md",
  "SECURITY.md",
  ".github/pull_request_template.md",
  "docs/governance/README.md",
  "docs/governance/policies/security.md",
  "apps/control-panel/DESIGN.md",
  "apps/control-panel/UX-CONTRACT.md",
  "packages/design-system/README.md"
];
for (const p of owners)
	if (!fs.existsSync(at(p)) || !fs.lstatSync(at(p)).isFile())
		fail("canonical owner missing " + p);

const governed = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "docs/governance/"])
  .split("\0").filter((p) => p.endsWith(".md"));
const seenOwners = new Set();
for (const p of governed) {
  if (!fs.existsSync(at(p))) fail("tracked governance owner missing " + p);
  const stat = fs.lstatSync(at(p));
  if (stat.isSymbolicLink()) fail("repository symlink is not scanned " + p);
  if (!stat.isFile()) fail("governance owner is not a file " + p);
  const body = get(p);
  const declaration = /^SEMANTIC_OWNER:\s*(\S+)\s*$/m.exec(body);
  if (!declaration || declaration[1] !== p || seenOwners.has(declaration[1]))
    fail("missing, duplicate, or misrouted semantic owner " + p);
  seenOwners.add(p);
}
// References in every current owner must resolve, not only those in the root router.
for (const source of governed) {
  for (const referenced of get(source).match(/docs\/governance\/[\w/-]+\.md/g) ?? []) {
    if (!seenOwners.has(referenced))
      fail("governance reference points to absent owner " + source + " -> " + referenced);
  }
}
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
const paths = git([
	"ls-files",
	"--cached",
	"--others",
	"--exclude-standard",
	"-z",
]).split("\0").filter(Boolean);
const oldRepo = ["bthwani2-boop/governance", "and-docs"].join("-"),
	oldSha = ["GOVERNANCE", "CANONICAL", "SHA"].join("_");
for (const p of paths) {
	// Only the verifier and its fixture source contain intentional legacy literals.
	if (
		p === "tools/governance/verify-governance.mjs" ||
		p === "tools/governance/verify-governance.test.mjs"
	) continue;
	if (!/\.(md|mdx|mjs|js|cjs|ts|tsx|json|jsonc|yml|yaml|ps1|psm1)$/.test(p))
		continue;
	let stat;
	try {
		stat = fs.lstatSync(at(p));
	} catch {
		fail("repository file missing " + p);
	}
	if (stat.isSymbolicLink()) fail("repository symlink is not scanned " + p);
	if (!stat.isFile()) continue;
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
const researchPath = "docs/reference/competitors";
const trustedTree = git(["rev-parse", trustedCommit + ":" + researchPath]);
const candidateTree = git(["rev-parse", "HEAD:" + researchPath]);
if (candidateTree !== trustedTree)
	fail("research Git tree differs from protected baseline " + trustedTree);
const worktreeDiff = spawnSync(
	"git",
	["diff", "--quiet", "--no-ext-diff", "--no-textconv", trustedCommit, "--", researchPath],
	{ cwd: root, encoding: "utf8" },
);
if (worktreeDiff.status !== 0)
	fail("research worktree differs from protected baseline " + trustedTree);
const untrackedResearch = git([
	"ls-files",
	"--others",
	"--exclude-standard",
	"-z",
	"--",
	researchPath,
]).split("\0").filter(Boolean);
if (untrackedResearch.length > 0)
	fail("untracked research files are not part of the protected baseline");
console.log("GOVERNANCE_INTEGRITY_PASS competitor_tree=" + candidateTree);
