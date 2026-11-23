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
  assert.equal(base.services["payment-mock"].build.context, "./payment-mock");
  assert.equal(base.services["payment-mock"].image, "bthwani/payment-mock:local");
  assert.ok(!base.services["payment-mock"].volumes?.length, "synthetic provider must not mount host/legacy data");
  assert.ok(!base.services.wlt, "No fake WLT runtime until real ledger owner exists");
});

test("WLT is the real isolated read-only owner and never a migration service", () => {
  const overlay = compose("compose.wlt.yaml");
  assert.deepEqual(Object.keys(overlay.services), ["wlt"]);
  const wlt = overlay.services.wlt;
  assert.deepEqual(wlt.profiles, ["wlt-reader"]);
  assert.equal(wlt.restart, "unless-stopped");
  assert.equal(wlt.read_only, true);
  assert.ok(wlt.cap_drop.includes("ALL"));
  assert.ok(wlt.security_opt.includes("no-new-privileges:true"));
  assert.deepEqual(wlt.networks, ["isolated", "loopback"]);
  assert.deepEqual(wlt.depends_on.postgres, { condition: "service_healthy" });
  assert.ok(wlt.ports.every((v) => v.startsWith("127.0.0.1:")));
  assert.equal(wlt.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(wlt.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
  assert.equal(wlt.environment.WLT_TEST_IDENTITY_ORIGIN, "http://identity:3302");
  assert.equal(wlt.environment.WLT_DEV_LISTEN_ADDR, "0.0.0.0:8080");
  assert.equal(wlt.environment.WLT_TEST_DATABASE_URL,
    "${REF_WLT_TEST_DATABASE_URL:?isolated WLT read-only PostgreSQL URL required}");
  assert.ok(!wlt.environment.WLT_SANDBOX_DATABASE_URL);
  assert.ok(!wlt.volumes?.length);
  assert.ok(wlt.healthcheck.test.includes("wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1"));
  const dockerfile = readFileSync(path.join(infra, "../services/wlt/backend/Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM golang:1\.27\.4-alpine@sha256:[a-f0-9]{64} AS build/m);
  assert.match(dockerfile, /^USER 65532:65532/m);
  assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/local\/bin\/wlt"\]/m);
  assert.doesNotMatch(dockerfile, /post-sandbox-funding|migrate|ENTRYPOINT \["\/bin\/sh"/);
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
  assert.equal(id.restart, "unless-stopped", "Identity must recover after Docker engine restart");
  assert.equal(id.read_only, true);
  assert.ok(id.cap_drop.includes("ALL"));
  assert.equal(id.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(id.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_PHONE_AUTH, "${REF_IDENTITY_SYNTHETIC_PHONE_AUTH:-false}");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_YEMEN_PHONES, "${REF_IDENTITY_SYNTHETIC_YEMEN_PHONES:-+967770000001}");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_PHONE_HMAC_KEY, "${REF_IDENTITY_SYNTHETIC_PHONE_HMAC_KEY:-}");
  assert.equal(id.environment.IDENTITY_SYNTHETIC_PHONE_SMTP, "mailpit:1025");
  assert.equal(id.environment.IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH,
    "${REF_IDENTITY_OPERATOR_PASSKEY_AUTH:-false}", "Passkey must not be on by default");
  assert.equal(id.environment.IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP,
    "${REF_IDENTITY_OPERATOR_BOOTSTRAP:-false}", "Root bootstrap must not be on by default");
  assert.equal(id.environment.IDENTITY_OPERATOR_PASSKEY_RPID,
    "${REF_IDENTITY_OPERATOR_PASSKEY_RPID:-}");
  assert.equal(id.environment.IDENTITY_OPERATOR_PASSKEY_ORIGINS,
    "${REF_IDENTITY_OPERATOR_PASSKEY_ORIGINS:-}");
  assert.equal(id.environment.IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN,
    "${REF_IDENTITY_OPERATOR_PERMISSION_ADMIN:-false}", "Permission administration requires its own opt-in");
  assert.ok(id.ports.every((v) => v.startsWith("127.0.0.1:")));
  assert.equal(id.depends_on.postgres.condition, "service_healthy");
  assert.ok(id.healthcheck.test.includes("wget -q -O /dev/null http://127.0.0.1:3302/health || exit 1"));
});

test("Merchant development overlay adds only private TLS and read-side standing", () => {
  const overlay = compose("compose.merchant-development.yaml");
  assert.deepEqual(Object.keys(overlay.services).sort(), ["dsh", "identity"]);
  const { dsh, identity } = overlay.services;
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_MERCHANT_STANDING, "true");
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_STANDING,
    "${REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING:-false}");
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST,
    "${REF_DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST:-false}");
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_STORE_AVAILABILITY, undefined);
  assert.equal(dsh.environment.DSH_IDENTITY_VERIFIER_URL, "https://identity:3343");
  assert.equal(dsh.environment.SSL_CERT_FILE, "/run/identity-ca/ca.pem");
  assert.deepEqual(dsh.volumes, ["merchant-identity-ca:/run/identity-ca:ro"]);
  assert.deepEqual(identity.volumes, ["merchant-identity-tls:/run/identity-tls:ro"]);
  assert.equal(identity.ports, undefined);
  assert.equal(dsh.ports, undefined);
});
