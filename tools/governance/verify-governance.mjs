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
  "docs/governance/safety.md",
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
// Resolve referenced local research files as well as governance owners; bare code-span paths are links in practice.
for (const source of governed) {
  for (const referenced of get(source).match(/docs\/reference\/[\w./-]+\.(?:md|csv)/g) ?? []) {
    if (!fs.existsSync(at(referenced)) || !fs.lstatSync(at(referenced)).isFile())
      fail("reference points to missing research file " + source + " -> " + referenced);
  }
}
// Validate the capability router against the admitted Product IDs and declared owners.
// This follows the live owner map instead of freezing a donor-era filename list.
const overview = get("docs/governance/product.md");
const admittedSection = overview.split("## Admitted capabilities\n")[1]?.split("\n## ")[0];
if (!admittedSection) fail("admitted capabilities section missing");
const admitted = [...admittedSection.matchAll(/^- `([A-Z][A-Z0-9_]*)`$/gm)].map((m) => m[1]);
if (!admitted.length || new Set(admitted).size !== admitted.length)
  fail("missing or duplicated admitted capability ID");
// A capability remains a unique durable decision even when several capabilities
// are consolidated in one semantic-owner document. The Product list is the census;
// each owner declares its individual sections, never a second routing document.
const actualCapabilities = new Map();
for (const owner of governed) {
  const body = get(owner);
  for (const match of body.matchAll(/^CAPABILITY_ID:\s*([A-Z][A-Z0-9_]*)\s*$/gm)) {
    const id = match[1];
    if (actualCapabilities.has(id)) fail("duplicate capability ID " + id);
    if (!new RegExp("^## " + id + " \\u2014 ", "m").test(body))
      fail("capability section heading missing " + id + " at " + owner);
    actualCapabilities.set(id, owner);
  }
}
if (actualCapabilities.size !== admitted.length ||
    admitted.some(id => !actualCapabilities.has(id)) ||
    [...actualCapabilities.keys()].some(id => !admitted.includes(id)))
  fail("admitted capability missing, extra, or orphaned in consolidated owners");
for (const [id, owner] of actualCapabilities) {
  if (!seenOwners.has(owner) || !get("docs/governance/README.md").includes(owner.slice("docs/governance/".length)))
    fail("capability lacks a routed semantic owner " + id + " -> " + owner);
}
// Current product decision boundaries; this is a static regression sentinel,
// not evidence that the app, finance and direct checkout flows are deployed.
const storeGovernance = get("docs/governance/stores.md");
const financeGovernance = get("docs/governance/finance.md");
const identityGovernance = get("docs/governance/identity.md");
const experienceGovernance = get("docs/governance/experience.md");
if (storeGovernance.includes("Current JoiningCase intake/submission") ||
    storeGovernance.includes("Operator initial admission of the submitted case"))
  fail("obsolete joining-case flow reintroduced as current");
if (!storeGovernance.includes("BTHWANI_PARTNER") ||
    !storeGovernance.includes("INDEPENDENT_STORE") ||
    !storeGovernance.includes("Client Expo Web app"))
  fail("Store relation or shared Client Web presentation decision missing");
if (!storeGovernance.includes("Both canonical Store-relation admission policies must govern every new Store creation") ||
    !storeGovernance.includes("fails closed if it is disabled or unavailable"))
  fail("Store creation across all entry points could bypass paused relation admission");
if (!financeGovernance.includes("Both Store relations can use **COMMISSION** or **SUBSCRIPTION**") ||
    !financeGovernance.includes("Only currently implemented and validated commission agreements") ||
    !storeGovernance.includes("INDEPENDENT_STORE may use COMMISSION") ||
    !overview.includes("either Store relation"))
  fail("commercial model independence or unreleased financial activation guard missing");
if (!identityGovernance.includes("finance\x60, \x60hr\x60") ||
    identityGovernance.includes("Partner/Captain/Field require"))
  fail("Operator HR permission or current-role correction missing");
if (!experienceGovernance.includes("full Store view opened via the Store's direct URL"))
  fail("unified Store presentation contract missing");
if (!experienceGovernance.includes("one Stores management center") ||
    experienceGovernance.includes("eleven work centers:"))
  fail("single Operator Stores center governance missing or superseded");
if (!experienceGovernance.includes("Merchant management experience") ||
    !experienceGovernance.includes("One canonical eligibility/readback decision"))
  fail("Merchant mobile/web Store management parity contract missing");
if (!storeGovernance.includes("Further Stores: one DSH create command") ||
    !storeGovernance.includes("The same validation and state defaults apply"))
  fail("additional Store single-writer/dual-entrypoint contract missing");
// Chronologically approved Product decisions: static semantic guardrails only,
// never proof that actual services, contract migrations or financial rails have shipped.
const governanceIndex = get("docs/governance/README.md");
const refoundationPlan = get("docs/governance/BTHWANI-FULL-SYSTEM-REFOUNDATION-PLAN.md");
if (!governanceIndex.includes("Approval chronology and conflict resolution") ||
    !refoundationPlan.includes("## 14. Chronological approval reconciliation"))
  fail("newer approved conversation decisions lack a routed owner/reconciliation trail");
if (!get("docs/governance/platform.md").includes("The clean-slate target uses `Customer`/`Merchant`") ||
    !storeGovernance.includes("Target customer-facing relation names are `MARKETPLACE`") ||
    !financeGovernance.includes("Three decisions remain separate"))
  fail("Customer/Merchant or Store/fee/collection decision dimensions lost");
if (!financeGovernance.includes("confirmed_order_total < available_cod_coverage") ||
    !financeGovernance.includes("cash_portion_to_reserve <= available_cod_coverage") ||
    !financeGovernance.includes("`PLATFORM_COLLECTION`/`MERCHANT_COLLECTION`") ||
    !storeGovernance.includes("No Store can enable BThwani Captain fulfillment merely") ||
    !get("docs/governance/fulfillment.md").includes("Both Store relationships may offer any supported subset"))
  fail("approved configurable fulfillment/collection/COD coverage contract lost");
if (!experienceGovernance.includes("eight primary navigation groups") ||
    !experienceGovernance.includes("bounded library of three to five accessible full-Store templates") ||
    !experienceGovernance.includes("one canonical BThwani brand/semantic-token source"))
  fail("Operator navigation or single Design Studio/design-token scope lost");
// Dormant legacy flow names are not part of the current durable Product vocabulary.
// Historical research/evidence files and Git history retain their own provenance.
for (const owner of [
  "platform.md", "identity.md", "stores.md", "catalog.md",
  "finance.md", "fulfillment.md", "journeys.md", "experience.md", "hr.md",
]) {
  if (/\bField\b|\bHYBRID\b|JoiningCase|joining.case/.test(get("docs/governance/" + owner)))
    fail("retired Product terminology reintroduced in " + owner);
}

const catalogGovernance = get("docs/governance/catalog.md");
const engineeringGovernance = get("docs/governance/engineering.md");
const platformGovernance = get("docs/governance/platform.md");
if (!catalogGovernance.includes("Minimal Store product-entry path") ||
    !catalogGovernance.includes("not a second catalog table family"))
  fail("single catalog with minimal Store offer creation safeguard missing");
if (!engineeringGovernance.includes("Policy defaults, runtime eligibility and owner-backed bootstrap") ||
    !platformGovernance.includes("User terminology versus deployed identifiers"))
  fail("owner policy bootstrap or user/deployable terminology boundary missing");

// Protected feature semantics: static deletion sentinels, not proof of runtime delivery.
const commerceGovernance = get("docs/governance/commerce.md");
const fulfillmentGovernance = get("docs/governance/fulfillment.md");
for (const [source, content, fragments] of [
  ["commerce.md", commerceGovernance, ["SHORT_FORM", "operational video"]],
  ["fulfillment.md", fulfillmentGovernance, ["opportunity maps", "minimum safe number"]],
  ["experience.md", experienceGovernance, ["One Studio authoring workflow", "Design My Store"]],
]) {
  for (const fragment of fragments) {
    if (!content.includes(fragment))
      fail("protected feature invariant missing " + source + " / " + fragment);
  }
}

if (fs.existsSync(at("knowledge.sources.json")))
	fail("external donor pin resurrected");
const placement = get("REPOSITORY-STRUCTURE.md");
const architectureGovernance = get("docs/governance/architecture.md");
if (!placement.includes("## Required naming and placement rules for refoundation") ||
    !placement.includes("## Structural acceptance for each affected slice") ||
    !architectureGovernance.includes("## Responsibility-shaped implementation boundaries") ||
    !engineeringGovernance.includes("### Structural cleanup within refoundation slices") ||
    !platformGovernance.includes("### Refoundation naming cutover") ||
    !refoundationPlan.includes("## 15. Structural refoundation evidence at each accepted slice"))
  fail("refoundation structural ownership, naming or cutover gates missing");
const law = get("AGENTS.md");
if (!law.includes("### Required structural responsibility check"))
  fail("agent structural ownership gate missing");
for (const x of [
	"## 1. Authority and exact state",
	"## 4. Local development state",
	"Professional product closure",
	"## 6. Consequential action safety",
	"## 8. Closure",
	"Mandatory refoundation capability-conservation and anti-drift gate",
	"docs/governance/README.md",
])
	if (!law.includes(x)) fail("agent rule lost " + x);
if (
	!get("README.md").includes("docs/governance/README.md") ||
	!get("SECURITY.md").includes("docs/governance/safety.md")
)
	fail("local ownership routing broken");
if (
	!get("docs/governance/README.md").includes(
		"docs/governance/product.md",
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
// An unstaged move leaves the removed tracked path in Git's index until staged.
// Canonical governance owners are already checked above and must never be skipped.
const pendingDeletions = new Set(git(["ls-files", "--deleted", "-z"]).split("\0").filter(Boolean));
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
	} catch (error) {
		if (error?.code === "ENOENT" && pendingDeletions.has(p)) continue;
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
		(p.startsWith("docs/governance/") || owners.includes(p) || p === "docs/reference/README.md") &&
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
