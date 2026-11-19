import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import YAML from "yaml";

const infra = path.dirname(fileURLToPath(import.meta.url));
function compose(name) {
  const document = YAML.parseDocument(readFileSync(path.join(infra, name), "utf8"), {
    strict: true, uniqueKeys: true,
  });
  assert.deepEqual(document.errors, [], `${name} must parse without duplicate keys`);
  return document.toJS();
}

test("database and mock integrations stay in one isolated project", () => {
  const base = compose("compose.yaml");
  assert.equal(base.name, "bthwani-refoundation");
  assert.equal(base.networks.isolated.internal, true);
  assert.ok(!base.services.postgres.ports?.length, "PostgreSQL must remain inaccessible from host");
  assert.ok(base.services.postgres.volumes.some((v) => v.startsWith("refoundation-postgres-data:")));
  for (const name of ["media", "mailpit", "payment-mock"]) {
    assert.ok(base.services[name].ports.every((v) => v.startsWith("127.0.0.1:")), name);
  }
  assert.ok(!base.services.wlt, "No fake WLT runtime until real ledger owner exists");
});

test("a normal implementation profile can never implicitly run SQL migrations", () => {
  const apps = compose("compose.apps.yaml");
  const service = apps.services.dsh;
  const migration = apps.services["dsh-migrate"];
  assert.deepEqual(service.profiles, ["implementation"]);
  assert.deepEqual(migration.profiles, ["migration"]);
  assert.ok(!migration.profiles.some((p) => service.profiles.includes(p)));
  assert.deepEqual(migration.entrypoint, ["/usr/local/bin/dsh", "-mode=migrate"]);
  assert.equal(migration.restart, "no");
  assert.equal(service.read_only, true);
  assert.ok(service.cap_drop.includes("ALL"));
  assert.ok(service.ports.every((v) => v.startsWith("127.0.0.1:")));
  assert.equal(service.depends_on.postgres.condition, "service_healthy");
  assert.equal(service.environment.DSH_IDENTITY_VERIFIER_URL, "${REF_DSH_IDENTITY_VERIFIER_URL:-}");
});

test("Identity verifier is synthetic only and has no privileged host exposure", () => {
  const overlay = compose("compose.identity-verifier.yaml");
  const id = overlay.services.identity;
  assert.ok(!overlay.services.wlt);
  assert.deepEqual(id.profiles, ["identity-verifier"]);
  assert.equal(id.read_only, true);
  assert.ok(id.cap_drop.includes("ALL"));
  assert.equal(id.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(id.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_PHONE_AUTH, "${REF_IDENTITY_SYNTHETIC_PHONE_AUTH:-false}");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_PHONE_HMAC_KEY, "${REF_IDENTITY_SYNTHETIC_PHONE_HMAC_KEY:-}");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_PHONE_SMTP, "mailpit:1025");
  assert.ok(id.ports.every((v) => v.startsWith("127.0.0.1:")));
  assert.equal(id.depends_on.postgres.condition, "service_healthy");
  assert.ok(id.healthcheck.test.includes("wget -q -O /dev/null http://127.0.0.1:3302/health || exit 1"));
});
