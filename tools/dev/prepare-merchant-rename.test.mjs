import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("tools/dev/prepare-merchant-rename.mjs");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bthwani-merchant-rename-"));
  const root = join(dir, "repo");
  mkdirSync(join(root, "governance"), { recursive: true });
  mkdirSync(join(root, "apps/merchant/src"), { recursive: true });
  mkdirSync(join(root, "services/identity/database/migrations"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"),
    "# Mandatory Customer/Merchant terminology and authorization guard\nNEVER rename partner words here\n");
  writeFileSync(join(root, "governance/platform.md"),
    "# CUSTOMER_MERCHANT_CANONICAL_TERMS\nLegacy partner examples must remain\n");
  writeFileSync(join(root, "apps/merchant/src/orders.ts"),
    'const partnerOrders = 1;\nconst PartnerProfile = "merchant";\nconst partners = 2;\nconst PartnersList = 3;\nconst PARTNERS_COUNT = 4;\nconst partnerId = "id";\nconst PartnerId = "id";\nconst PARTNER_ID = "id";\nconst partnership = "unchanged";\nconst legacy = "app-partner";\n');
  writeFileSync(join(root, "apps/merchant/src/dirty.ts"), 'const partnerOrder = true;\n');
  writeFileSync(join(root, "services/identity/database/migrations/002_test.sql"),
    "CREATE TABLE partner_legacy_test(id bigint);\n");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-qm", "fixture",
  ], { cwd: root });
  writeFileSync(join(root, "apps/merchant/src/dirty.ts"),
    'const partnerOrder = true;\nconst unsaved = 1;\n');
  return {
    dir, root, manifest: join(dir, "review.json"),
    orders: join(root, "apps/merchant/src/orders.ts"),
    agent: join(root, "AGENTS.md"),
    policy: join(root, "governance/platform.md"),
  };
}

test("plan never writes source, and excludes policy, dirty code, SQL, and external IDs", () => {
  const f = fixture();
  try {
    const previousCode = readFileSync(f.orders, "utf8");
    const previousAgent = readFileSync(f.agent, "utf8");
    const previousPolicy = readFileSync(f.policy, "utf8");
    const p = run(["plan", "--root", f.root, "--out", f.manifest]);
    assert.equal(p.status, 0, p.stderr);
    const data = JSON.parse(readFileSync(f.manifest, "utf8"));
    assert.equal(data.entries.length, 8);
    assert.ok(data.entries.every((x) => x.approved === false));
    assert.ok(data.skipped.some((x) => x.reason === "DIRTY_FILE_SKIP"));
    assert.ok(data.skipped.some((x) => x.reason === "SQL_CONTRACT_OR_GENERATED_MANUAL"));
    assert.ok(data.skipped.some((x) => x.reason === "PROTECTED_POLICY_OR_HISTORY"));
    assert.ok(data.skipped.some((x) => x.reason === "EXTERNAL_COMPATIBILITY_ID_MANUAL"));
    assert.equal(readFileSync(f.orders, "utf8"), previousCode);
    assert.equal(readFileSync(f.agent, "utf8"), previousAgent);
    assert.equal(readFileSync(f.policy, "utf8"), previousPolicy);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("apply modifies only explicitly approved lines and retains policy byte-for-byte", () => {
  const f = fixture();
  try {
    const p = run(["plan", "--root", f.root, "--out", f.manifest]);
    assert.equal(p.status, 0, p.stderr);
    const data = JSON.parse(readFileSync(f.manifest, "utf8"));
    data.entries[0].approved = true;
    writeFileSync(f.manifest, JSON.stringify(data, null, 2));
    const previousAgent = readFileSync(f.agent);
    const previousPolicy = readFileSync(f.policy);
    const result = run(["apply", "--root", f.root, "--manifest", f.manifest]);
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(f.orders, "utf8");
    assert.match(output, /merchantOrders/);
    assert.match(output, /PartnerProfile/);
    assert.match(output, /app-partner/);
    assert.deepEqual(readFileSync(f.agent), previousAgent);
    assert.deepEqual(readFileSync(f.policy), previousPolicy);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("apply rejects modified source, changed policy and unapproved manifests", () => {
  const f = fixture();
  try {
    const p = run(["plan", "--root", f.root, "--out", f.manifest]);
    assert.equal(p.status, 0, p.stderr);
    const data = JSON.parse(readFileSync(f.manifest, "utf8"));
    const unapproved = run(["apply", "--root", f.root, "--manifest", f.manifest]);
    assert.notEqual(unapproved.status, 0);
    data.entries[0].approved = true;
    writeFileSync(f.manifest, JSON.stringify(data));
    writeFileSync(f.policy, readFileSync(f.policy, "utf8") + "\nchanged");
    const alteredPolicy = run(["apply", "--root", f.root, "--manifest", f.manifest]);
    assert.notEqual(alteredPolicy.status, 0);
    assert.match(readFileSync(f.orders, "utf8"), /partnerOrders/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("apply rejects a manifest entry that targets AGENTS.md", () => {
  const f = fixture();
  try {
    const p = run(["plan", "--root", f.root, "--out", f.manifest]);
    assert.equal(p.status, 0, p.stderr);
    const data = JSON.parse(readFileSync(f.manifest, "utf8"));
    data.entries[0] = {
      ...data.entries[0], path: "AGENTS.md", approved: true,
    };
    writeFileSync(f.manifest, JSON.stringify(data));
    const result = run(["apply", "--root", f.root, "--manifest", f.manifest]);
    assert.notEqual(result.status, 0);
    assert.match(readFileSync(f.agent, "utf8"), /NEVER rename partner words here/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("approved domain rename preserves singular, plural, casing and unrelated English words", () => {
  const f = fixture();
  try {
    const p = run(["plan", "--root", f.root, "--out", f.manifest]);
    assert.equal(p.status, 0, p.stderr);
    const data = JSON.parse(readFileSync(f.manifest, "utf8"));
    assert.equal(data.entries.length, 8);
    assert.ok(data.entries.every((entry) => entry.approved === false));
    const changes = new Map(data.entries.map((item) => [item.before.trim(), item.after.trim()]));
    assert.equal(changes.get("const partners = 2;"), "const merchants = 2;");
    assert.equal(changes.get("const PartnersList = 3;"), "const MerchantsList = 3;");
    assert.equal(changes.get("const PARTNERS_COUNT = 4;"), "const MERCHANTS_COUNT = 4;");
    assert.equal(changes.get('const partnerId = "id";'), 'const merchantId = "id";');
    assert.equal(changes.get('const PartnerId = "id";'), 'const MerchantId = "id";');
    assert.equal(changes.get('const PARTNER_ID = "id";'), 'const MERCHANT_ID = "id";');
    for (const entry of data.entries) entry.approved = true;
    writeFileSync(f.manifest, JSON.stringify(data, null, 2));
    const apply = run(["apply", "--root", f.root, "--manifest", f.manifest]);
    assert.equal(apply.status, 0, apply.stderr);
    const result = readFileSync(f.orders, "utf8");
    assert.match(result, /const merchants = 2;/);
    assert.match(result, /const MerchantsList = 3;/);
    assert.match(result, /const MERCHANTS_COUNT = 4;/);
    assert.match(result, /const merchantId = "id";/);
    assert.match(result, /const MerchantId = "id";/);
    assert.match(result, /const MERCHANT_ID = "id";/);
    assert.match(result, /const partnership = "unchanged";/);
    assert.match(result, /const legacy = "app-partner";/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
