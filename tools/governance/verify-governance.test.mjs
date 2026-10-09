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
	return dir;
}
function run(dir) {
	return spawnSync(process.execPath, [guard, "--root", dir], {
		encoding: "utf8",
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
		"deleted research file fails",
		(dir) =>
			fs.unlinkSync(path.join(dir, "docs/reference/competitors/nass.md")),
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
		const dir = fixture();
		try {
			mutate(dir);
			const r = run(dir);
			assert.equal(
				r.status === 0,
				pass,
				label + ": " + r.stdout + " " + r.stderr,
			);
			if (!pass) assert.match(r.stderr, /GOVERNANCE_INTEGRITY_FAIL/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
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
  for(const p of ["AGENTS.md","docs/governance/product/overview.md","docs/reference/competitors/README.md","tools/governance/verify-governance.mjs",".github/workflows/ci-static.yml","apps/control-panel/UX-CONTRACT.md"])assert.equal(re.test(p),true,"governance-only "+p);
  for(const p of ["services/dsh/backend/internal/catalog/x.go","services/identity/backend/internal/session/x.go","services/wlt/backend/internal/ledger/x.go","apps/control-panel/src/features/central-catalog/x.tsx","infra/local/compose/compose.yaml",".github/workflows/ci-runtime.yml","tests/runtime/verify-dsh-runtime-core.mjs"])assert.equal(re.test(p),false,"implementation must retain normal checks "+p);
});
