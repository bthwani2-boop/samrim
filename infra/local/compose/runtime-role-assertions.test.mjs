import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const provisioning = readFileSync(join(directory, "runtime-roles.sql"), "utf8");
const verification = readFileSync(join(directory, "verify-runtime-access.sh"), "utf8");

const required = [
  { role: "samrim_identity_runtime", table: "public.identity_actors", rights: ["SELECT", "INSERT", "UPDATE"] },
  { role: "samrim_dsh_runtime", table: "dsh.stores", rights: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  { role: "samrim_wlt_runtime", table: "wlt.payment_intents", rights: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
];

test("provisioning asserts every positive PostgreSQL table privilege separately", () => {
  for (const { role, table, rights } of required) {
    for (const right of rights) {
      const predicate = `NOT has_table_privilege('${role}','${table}','${right}')`;
      assert.ok(provisioning.includes(predicate), `missing fail-closed ${role} ${table} ${right}`);
    }
    assert.ok(
      !provisioning.includes(`has_table_privilege('${role}','${table}','${rights.join(",")}')`),
      `comma-separated rights use ANY semantics, not ALL: ${role} ${table}`,
    );
  }
});

test("runtime login assertions require each privilege rather than any privilege", () => {
  for (const { role, table, rights } of required) {
    const line = verification.split(/\r?\n/).find((value) => value.startsWith(`assert_true ${role} `));
    assert.ok(line, `missing actual login proof for ${role}`);
    for (const right of rights) {
      assert.ok(
        line.includes(`has_table_privilege(current_user,'${table}','${right}')`),
        `missing ${role} ${right} login verification`,
      );
    }
    assert.ok(!line.includes(`'${rights.join(",")}'`), `ANY-semantics check for ${role}`);
    assert.equal(
      (line.match(/has_table_privilege\(current_user,/g) ?? []).length >= rights.length,
      true,
      `not enough independent checks for ${role}`,
    );
  }
});
