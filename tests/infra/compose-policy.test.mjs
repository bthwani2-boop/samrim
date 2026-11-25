import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import YAML from "yaml";

const infra = fileURLToPath(new URL("../../infra/", import.meta.url));
// Closed transitional allowlist; shrink it when each existing overlay is retired.
// A runtime consumer cannot admit new application-specific definitions by editing its own list.
const admittedComposeFiles = ["compose.yaml", "compose.dsh.yaml", "compose.identity.yaml", "compose.merchant.yaml", "compose.captain.yaml", "compose.wlt.yaml"];
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
  assert.equal(base.services["payment-mock"].build.context, "../tests/infra/payment-mock");
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

test("a normal implementation profile can never implicitly bootstrap SQL", () => {
  const apps = compose("compose.dsh.yaml");
  const service = apps.services.dsh;
  const bootstrap = apps.services["dsh-bootstrap"];
  assert.equal(apps.services["dsh-migrate"], undefined);
  assert.deepEqual(service.profiles, ["implementation"]);
  assert.deepEqual(bootstrap.profiles, ["bootstrap"]);
  assert.ok(!bootstrap.profiles.some((p) => service.profiles.includes(p)));
  assert.deepEqual(bootstrap.entrypoint, ["/usr/local/bin/dsh", "-mode=bootstrap"]);
  assert.equal(bootstrap.restart, "no");
  assert.equal(bootstrap.environment.BTHWANI_ISOLATED_TEST_MODE, "true",
    "reviewed baseline must pass the owner's explicit isolation gate");
  assert.deepEqual(bootstrap.networks, ["isolated"]);
  assert.equal(bootstrap.ports, undefined, "one-shot bootstrap never exposes a public port");
  assert.equal(service.read_only, true);
  assert.ok(service.cap_drop.includes("ALL"));
  assert.ok(service.ports.every((v) => v.startsWith("127.0.0.1:")));
  assert.equal(service.depends_on.postgres.condition, "service_healthy");
  assert.equal(service.environment.REF_POSTGRES_USER, "${REF_DSH_RUNTIME_USER:?provision limited DSH runtime role}");
  assert.equal(service.environment.REF_POSTGRES_PASSWORD, "${REF_DSH_RUNTIME_PASSWORD:?provision dedicated DSH runtime credentials}");
  assert.equal(service.environment.REF_POSTGRES_DB, "${REF_DSH_RUNTIME_DATABASE:?provision dedicated DSH database}");
  assert.equal(bootstrap.environment.REF_POSTGRES_USER, "${REF_DSH_BOOTSTRAP_USER:-}");
  assert.equal(bootstrap.environment.REF_POSTGRES_PASSWORD, "${REF_DSH_BOOTSTRAP_PASSWORD:-}");
  assert.equal(service.environment.DSH_IDENTITY_VERIFIER_URL, "${REF_DSH_IDENTITY_VERIFIER_URL:-}");
  assert.equal(service.environment.DSH_ENABLE_ISOLATED_CUSTOMER_CART, "${REF_DSH_ENABLE_ISOLATED_CUSTOMER_CART:-false}");
  assert.equal(service.environment.DSH_ENABLE_ISOLATED_EMPLOYEES, "${REF_DSH_ENABLE_ISOLATED_EMPLOYEES:-false}", "Employee directory must require explicit isolated opt-in");
  assert.equal(service.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(service.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
});

test("Identity verifier is synthetic only and has no privileged host exposure", () => {
  const overlay = compose("compose.identity.yaml");
  const id = overlay.services.identity;
  assert.ok(!overlay.services.wlt);
  assert.deepEqual(id.profiles, ["identity-verifier"]);
  assert.equal(id.restart, "unless-stopped", "Identity must recover after Docker engine restart");
  assert.equal(id.read_only, true);
  assert.ok(id.cap_drop.includes("ALL"));
  assert.equal(id.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(id.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
  assert.equal(id.environment.IDENTITY_TEST_DATABASE_URL, "${REF_IDENTITY_RUNTIME_DATABASE_URL:?provision dedicated Identity runtime credentials}");
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
  const overlay = compose("compose.merchant.yaml");
  assert.deepEqual(Object.keys(overlay.services).sort(), ["dsh", "identity"]);
  const { dsh, identity } = overlay.services;
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_MERCHANT_STANDING, "true");
  for (const key of ["BTHWANI_ISOLATED_TEST_MODE", "BTHWANI_ISOLATED_CONTAINER_MODE"]) {
    assert.equal(dsh.environment[key], undefined, "base DSH owns isolation mode");
    assert.equal(compose("compose.dsh.yaml").services.dsh.environment[key], "true");
  }
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_STANDING,
    "${REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING:-false}");
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST,
    "${REF_DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST:-false}");
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_STORE_AVAILABILITY,
    "${REF_DSH_ENABLE_ISOLATED_STORE_AVAILABILITY:-false}", "Store operations and policy history require their own explicit opt-in");
  assert.equal(dsh.environment.DSH_IDENTITY_VERIFIER_URL, "https://identity:3343");
  assert.equal(dsh.environment.SSL_CERT_FILE, "/run/identity-ca/ca.pem");
  assert.deepEqual(dsh.volumes, ["merchant-identity-ca:/run/identity-ca:ro"]);
  assert.deepEqual(identity.volumes, ["merchant-identity-tls:/run/identity-tls:ro"]);
  assert.equal(identity.ports, undefined);
  assert.equal(dsh.ports, undefined);
});

test("Captain admission uses only the private DSH TLS owner and a dedicated trust volume", () => {
  const overlay = compose("compose.captain.yaml");
  const { identity, dsh } = overlay.services;
  assert.equal(identity.environment.IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION, "true");
  assert.equal(identity.environment.IDENTITY_DSH_CAPTAIN_STANDING_URL, "https://dsh:3344");
  assert.equal(identity.environment.IDENTITY_DSH_CAPTAIN_STANDING_CA, "/run/dsh-captain-ca/ca.pem");
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_STANDING, "true");
  assert.equal(dsh.environment.DSH_ISOLATED_CAPTAIN_TLS_CERT, "/run/dsh-captain-tls/server.pem");
  assert.equal(dsh.environment.DSH_ISOLATED_CAPTAIN_TLS_KEY, "/run/dsh-captain-tls/server-key.pem");
  assert.deepEqual(identity.volumes, ["captain-dsh-ca:/run/dsh-captain-ca:ro"]);
  assert.deepEqual(dsh.volumes, ["captain-dsh-tls:/run/dsh-captain-tls:ro"]);
  assert.equal(identity.ports, undefined);
  assert.equal(dsh.ports, undefined);
  assert.equal(overlay.volumes["captain-dsh-ca"].external, true);
  assert.equal(overlay.volumes["captain-dsh-tls"].external, true);
});
test("the disposable Operator stack remains separate from shared owner state", () => {
  const stack = compose("../tests/infra/compose.operator-webauthn-sandbox.yaml");
  assert.equal(stack.name, "bthwani-operator-webauthn-s02");
  assert.equal(stack.networks.private.internal, true);
  assert.deepEqual(Object.keys(stack.services).sort(), ["identity", "postgres"]);
  for (const service of Object.values(stack.services)) {
    assert.ok(service.ports.every(port => port.startsWith("127.0.0.1:")));
  }
  assert.deepEqual(stack.services.postgres.volumes, ["operator-s02-postgres-data:/var/lib/postgresql"]);
  assert.deepEqual(Object.keys(stack.volumes), ["operator-s02-postgres-data"]);
  assert.equal(stack.services.identity.build.context, "../../services/identity");
  assert.equal(stack.services.identity.read_only, true);
  assert.ok(stack.services.identity.cap_drop.includes("ALL"));
});

test("the public environment example covers every Compose input without granting credentials or activating capabilities", () => {
  const files = admittedComposeFiles;
  const required = new Set();
  const defaults = new Map();
  for (const file of files) {
    const source = readFileSync(path.join(infra, file), "utf8");
    for (const [, key, op, value] of source.matchAll(/\$\{(REF_[A-Z0-9_]+):([-?])([^}]*)\}/g)) {
      if (op === "?") required.add(key);
      else {
        assert.ok(!defaults.has(key) || defaults.get(key) === value, "inconsistent default: " + key);
        defaults.set(key, value);
      }
    }
  }
  const entries = readFileSync(path.join(infra, ".env.example"), "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#"));
  const keys = new Set();
  const values = new Map();
  for (const line of entries) {
    const match = /^(REF_[A-Z0-9_]+)=(.*)$/.exec(line);
    assert.ok(match, "invalid template entry");
    assert.ok(!keys.has(match[1]), "duplicate template key: " + match[1]);
    keys.add(match[1]);
    values.set(match[1], match[2]);
  }
  assert.deepEqual([...keys].sort(), [...new Set([...required, ...defaults.keys()])].sort());
  for (const [key, value] of defaults) assert.equal(values.get(key), value, key);
  for (const key of required) {
    if (key === "REF_POSTGRES_USER") assert.equal(values.get(key), "bthwani_refoundation_admin");
    else if (key === "REF_POSTGRES_DB") assert.equal(values.get(key), "bthwani_refoundation");
    else if (key === "REF_DSH_RUNTIME_DATABASE") assert.equal(values.get(key), "bthwani_dsh_dev");
    else if (key === "REF_DSH_RUNTIME_USER") assert.equal(values.get(key), "bthwani_dsh_runtime");
    else assert.equal(values.get(key), "", "must be explicitly provisioned: " + key);
  }
});

test("shared infrastructure admits no new application or capability Compose files", async () => {
  const { ownerComposeInputs } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  const files = readdirSync(infra, { recursive: true })
    .map(name => name.replaceAll("\\", "/"))
    .filter(name => /(?:^|\/)(?:docker-)?compose(?:[.-][^/]*)?\.ya?ml$/i.test(name))
    .map(name => "infra/" + name)
    .sort();
  assert.ok(files.includes("infra/compose.yaml"), "canonical environment definition is required");
  const allowed = admittedComposeFiles.map(name => "infra/" + name).sort();
  assert.deepEqual([...ownerComposeInputs].sort(), allowed, "runtime input scope must match the transitional allowlist");
  assert.deepEqual(files, allowed, "new application/capability Compose files are forbidden; existing overlays are transitional");
});
