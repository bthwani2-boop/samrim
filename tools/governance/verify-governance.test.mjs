import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)),
	root = path.resolve(here, "../.."),
	guard = path.join(here, "verify-governance.mjs");
const files = [
	"AGENTS.md",
	"README.md",
	"REPOSITORY-STRUCTURE.md",
	"SECURITY.md",
	".github/pull_request_template.md",
	"apps/control-panel/DESIGN.md",
	"apps/control-panel/UX-CONTRACT.md",
	"packages/design-system/README.md",
];
function git(dir, args) {
	const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
	return r.stdout.trim();
}
function commit(dir, message) {
	git(dir, ["add", "--all"]);
	git(dir, [
		"-c",
		"user.name=Governance Fixture",
		"-c",
		"user.email=governance-fixture@example.invalid",
		"commit",
		"--quiet",
		"--no-verify",
		"-m",
		message,
	]);
}
function fixture() {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "bthwani-governance-fixture-"),
	);
	assert.equal(
		spawnSync("git", ["init", "--quiet", dir], { encoding: "utf8" }).status,
		0,
	);
	for (const f of files) {
		const dst = path.join(dir, f);
		fs.mkdirSync(path.dirname(dst), { recursive: true });
		fs.copyFileSync(path.join(root, f), dst);
	}
	for (const p of ["docs/governance", "docs/reference/competitors"])
		fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
	commit(dir, "trusted fixture baseline");
	return { dir, trustedRef: git(dir, ["rev-parse", "HEAD"]) };
}
function run(f) {
	return spawnSync(process.execPath, [guard, "--root", f.dir], {
		encoding: "utf8",
		env: {
			...process.env,
			GITHUB_EVENT_PATH: "",
			GOVERNANCE_TRUSTED_REF: f.trustedRef,
		},
	});
}
const cases = [
	["clean snapshot passes", () => {}, true],
	[
		"broken local link fails",
		(dir) =>
			fs.appendFileSync(
				path.join(dir, "docs/governance/README.md"),
				"\n[broken](./nonexistent.md)\n",
			),
		false,
	],
	[
		"legacy governance pin fails",
		(dir) => fs.writeFileSync(path.join(dir, "knowledge.sources.json"), "{}"),
		false,
	],
	[
		"stale authority reference fails",
		(dir) =>
			fs.appendFileSync(
				path.join(dir, "README.md"),
				"\nThe obsolete authority is knowledge.sources.json\n",
			),
		false,
	],
	[
		"altered research blob fails",
		(dir) =>
			fs.appendFileSync(
				path.join(dir, "docs/reference/competitors/etlobni.md"),
				"\nunauthorized edit\n",
			),
		false,
	],
	[
		"untracked research file fails",
		(dir) =>
			fs.writeFileSync(
				path.join(dir, "docs/reference/competitors/extra.md"),
				"unexpected research\n",
			),
		false,
	],
	[
		"new governance helper cannot reintroduce donor authority",
		(dir) => {
			const helper = path.join(dir, "tools/governance/legacy-helper.mjs");
			fs.mkdirSync(path.dirname(helper), { recursive: true });
			fs.writeFileSync(helper, 'export const GOVERNANCE_CANONICAL_SHA = "stale";\n');
		},
		false,
	],
	[
		"deleted research file fails",
		(dir) =>
			fs.unlinkSync(path.join(dir, "docs/reference/competitors/nass.md")),
		false,
	],
	[
		"missing research directory fails with governed error",
		(dir) => fs.rmSync(path.join(dir, "docs/reference/competitors"), { recursive: true }),
		false,
	],
	[
		"missing security owner fails",
		(dir) =>
			fs.unlinkSync(path.join(dir, "docs/governance/policies/security.md")),
		false,
	],
	[
		"lost primary owner route fails",
		(dir) =>
			fs.writeFileSync(
				path.join(dir, "README.md"),
				"# Missing governance entrypoint\n",
			),
		false,
	],
];
for (const [label, mutate, pass] of cases)
	test(label, () => {
		const f = fixture();
		try {
			mutate(f.dir);
			const r = run(f);
			assert.equal(
				r.status === 0,
				pass,
				label + ": " + r.stdout + " " + r.stderr,
			);
			if (!pass) assert.match(r.stderr, /GOVERNANCE_INTEGRITY_FAIL/);
		} finally {
			fs.rmSync(f.dir, { recursive: true, force: true });
		}
	});
test("committed research changes remain bound to the trusted base", () => {
	const f = fixture();
	try {
		fs.appendFileSync(
			path.join(f.dir, "docs/reference/competitors/etlobni.md"),
			"\ncommitted change\n",
		);
		commit(f.dir, "candidate research change");
		const r = run(f);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /GOVERNANCE_INTEGRITY_FAIL/);
	} finally {
		fs.rmSync(f.dir, { recursive: true, force: true });
	}
});
test("changed research mode remains bound to the trusted base", () => {
	const f = fixture();
	try {
		git(f.dir, [
			"update-index",
			"--chmod=+x",
			"docs/reference/competitors/nass.md",
		]);
		git(f.dir, [
			"-c",
			"user.name=Governance Fixture",
			"-c",
			"user.email=governance-fixture@example.invalid",
			"commit",
			"--quiet",
			"--no-verify",
			"-m",
			"candidate research mode change",
		]);
		const r = run(f);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /GOVERNANCE_INTEGRITY_FAIL/);
	} finally {
		fs.rmSync(f.dir, { recursive: true, force: true });
	}
});
test("ignored local work is excluded from repository integrity scanning", () => {
	const f = fixture();
	try {
		fs.appendFileSync(
			path.join(f.dir, ".git/info/exclude"),
			"\n/ignored-local-work/\n",
		);
		const ignored = path.join(f.dir, "ignored-local-work");
		fs.mkdirSync(ignored, { recursive: true });
		const obsoleteAuthority = [
			"bthwani2-boop/governance",
			"and-docs",
		].join("-");
		fs.writeFileSync(path.join(ignored, "DESIGN.md"), obsoleteAuthority);
		const r = run(f);
		assert.equal(r.status, 0, r.stdout + " " + r.stderr);
	} finally {
		fs.rmSync(f.dir, { recursive: true, force: true });
	}
});
test("repository symlinks fail closed instead of hiding scanned content", (t) => {
	if (process.platform === "win32") return t.skip("symlink creation requires a Windows privilege");
	const f = fixture();
	try {
		const target = path.join(f.dir, "external-owner.md");
		fs.writeFileSync(target, "knowledge.sources.json\n");
		fs.symlinkSync(target, path.join(f.dir, "docs/governance/linked-owner.md"));
		const r = run(f);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /repository symlink is not scanned/);
	} finally {
		fs.rmSync(f.dir, { recursive: true, force: true });
	}
});
test("new branch events use protected main and ignore environment baseline overrides", () => {
	const eventDir = fs.mkdtempSync(path.join(os.tmpdir(), "bthwani-governance-event-"));
	const eventPath = path.join(eventDir, "event.json");
	fs.writeFileSync(eventPath, JSON.stringify({ before: "0".repeat(40) }));
	try {
		const rootArgument = process.platform === "win32" ? root.toUpperCase() : root;
		const r = spawnSync(process.execPath, [guard, "--root", rootArgument], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				GITHUB_EVENT_PATH: eventPath,
				GITHUB_SHA: "0".repeat(40),
				GOVERNANCE_TRUSTED_REF: "0".repeat(40),
			},
		});
		assert.equal(r.status, 0, r.stdout + " " + r.stderr);
		assert.match(r.stdout, /GOVERNANCE_INTEGRITY_PASS competitor_tree=/);
	} finally {
		fs.rmSync(eventDir, { recursive: true, force: true });
	}
});
test("legacy adapter removal requires consumer cutover and regression", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bthwani-adapter-proof-"));
	try {
		const legacy = path.join(dir, "legacy-adapter.mjs"),
			consumer = path.join(dir, "consumer.mjs"),
			canonical = path.join(dir, "canonical.mjs");
		fs.writeFileSync(legacy, "export const value = 12;\n");
		fs.writeFileSync(canonical, "export const value = 12;\n");
		fs.writeFileSync(
			consumer,
			"import {value} from './legacy-adapter.mjs'; if(value!==12) throw Error('regression');\n",
		);
		const regression = () =>
			spawnSync(process.execPath, [consumer], { encoding: "utf8" }).status;
		assert.equal(regression(), 0);
		assert.match(fs.readFileSync(consumer, "utf8"), /legacy-adapter/);
		fs.rmSync(legacy);
		assert.notEqual(regression(), 0, "live consumer must block deletion");
		fs.writeFileSync(legacy, "export const value = 12;\n");
		fs.writeFileSync(
			consumer,
			"import {value} from './canonical.mjs'; if(value!==12) throw Error('regression');\n",
		);
		assert.equal(regression(), 0);
		assert.doesNotMatch(fs.readFileSync(consumer, "utf8"), /legacy-adapter/);
		fs.rmSync(legacy);
		assert.equal(regression(), 0, "only safe after verified cutover");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("governance-only routing cannot exempt executable or runtime changes", () => {
  const staticFlow=fs.readFileSync(path.join(root,".github/workflows/ci-static.yml"),"utf8");
  const runtimeFlow=fs.readFileSync(path.join(root,".github/workflows/ci-runtime.yml"),"utf8");
  const localGuard=fs.readFileSync(path.join(root,"tools/dev/check-local.ps1"),"utf8");
  const staticRe=staticFlow.match(/grep -Evq '([^']+)'/);
  const runtimeRe=runtimeFlow.match(/grep -Evq '([^']+)'/);
  const localRe=localGuard.match(/\$governanceOnlyPattern = '([^']+)'/);
  assert.ok(staticRe&&runtimeRe&&localRe,"all three scope owners are explicit");
  assert.equal(staticRe[1],runtimeRe[1]);
  assert.equal(staticRe[1],localRe[1]);
  const re=new RegExp(staticRe[1]);
  for(const p of ["AGENTS.md","docs/governance/product/overview.md","docs/reference/competitors/README.md","tools/governance/verify-governance.mjs","apps/control-panel/UX-CONTRACT.md"])assert.equal(re.test(p),true,"governance-only "+p);
  for(const p of ["services/dsh/backend/internal/catalog/x.go","services/identity/backend/internal/session/x.go","services/wlt/backend/internal/ledger/x.go","apps/control-panel/src/features/central-catalog/x.tsx","infra/local/compose/compose.yaml",".github/workflows/ci-runtime.yml",".github/workflows/ci-static.yml",".github/CODEOWNERS","tools/dev/check-local.ps1","tests/runtime/verify-dsh-runtime-core.mjs"])assert.equal(re.test(p),false,"implementation must retain normal checks "+p);
});

test("committed governance candidates cannot bypass integrity verification", () => {
  const source = fs.readFileSync(path.join(root, "tools/dev/check-local.ps1"), "utf8");
  const candidate = source.split("if ($Candidate) {")[1]?.split("    $files = @(")[0] ?? "";
  assert.match(candidate, /git diff --name-only \$governanceBase \$head/);
  assert.match(candidate, /\$env:NX_BASE = \$governanceBase/);
  assert.match(candidate, /Where-Object \{ \$_ -notmatch \$governanceOnlyPattern \}/);
  assert.match(candidate, /--base=\$governanceBase --head=\$head/);
  const candidateFiles = candidate.indexOf("$candidateFiles = @(git diff");
  const nxAffected = candidate.indexOf("pnpm exec nx affected");
  assert.ok(candidateFiles >= 0, "candidate files must be computed");
  assert.ok(nxAffected >= 0, "affected Nx verification must exist");
  assert.ok(nxAffected > candidateFiles, "Nx only after affected scope is known");
  assert.match(candidate, /refs\/remotes\/origin\/main/);
  assert.match(candidate, /node tools\/governance\/verify-governance\.mjs/);
  assert.match(candidate, /node --test tools\/governance\/verify-governance\.test\.mjs/);
  assert.ok(candidate.indexOf("node --test tools/governance/verify-governance.test.mjs") < candidate.indexOf('Write-Host "VERIFY=PASS'), "candidate PASS must follow governance proof");
});

test("local mixed-scope changes still verify governance before Nx", () => {
  const source = fs.readFileSync(path.join(root, "tools/dev/check-local.ps1"), "utf8");
  const local = source.split("    $files = @(")[1] ?? "";
  assert.match(local, /\$governanceChanged = @\(\$files \| Where-Object \{ \$_ -match \$governanceOnlyPattern \}\)\.Count -gt 0/);
  assert.match(local, /if \(\$governanceChanged\) \{/);
  const integrityCheck = local.indexOf("node tools/governance/verify-governance.mjs");
  const fixtureCheck = local.indexOf("node --test tools/governance/verify-governance.test.mjs");
  const nxDiscovery = local.indexOf("pnpm exec nx show projects");
  assert.ok(integrityCheck >= 0, "the integrity check must exist");
  assert.ok(fixtureCheck >= 0, "the adversarial fixture run must exist");
  assert.ok(nxDiscovery >= 0, "the Nx discovery step must exist");
  assert.ok(integrityCheck < nxDiscovery, "integrity runs on mixed changes before Nx");
  assert.ok(fixtureCheck < nxDiscovery, "adversarial fixtures run on mixed changes before Nx");
  assert.match(local, /tools\/\(dev\|governance\)\//, "governance tooling changes must run Biome locally");
});
