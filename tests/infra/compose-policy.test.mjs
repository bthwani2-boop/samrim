import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import YAML from "yaml";

const infra = fileURLToPath(new URL("../../infra/", import.meta.url));
const admittedComposeFiles = ["compose.yaml"];
function compose(name) {
  const document = YAML.parseDocument(readFileSync(path.join(infra, name), "utf8"), {
    strict: true, uniqueKeys: true, merge: true,
  });
  assert.deepEqual(document.errors, [], `${name} must parse without duplicate keys`);
  return document.toJS();
}

test("one native Compose build definition per owner; no serving start required", () => {
  const model = compose("compose.yaml");
  for (const owner of ["identity", "dsh", "wlt"]) {
    const build = model.services[owner].build;
    assert.ok(build, owner + " must use native Compose build");
    assert.equal(build.context, "${BTHWANI_BUILD_CONTEXT:-../services/" + owner + "}");
    assert.equal(build.dockerfile, "backend/Dockerfile");
    assert.equal(build.args.SAMRIM_SOURCE_REVISION, "${BTHWANI_BUILD_REVISION:-unverified}");
    assert.equal(build.labels["com.bthwani.source-sha"], "${BTHWANI_BUILD_SHA:-}");
    assert.equal(build.labels["com.bthwani.preview-base"], "${BTHWANI_BUILD_PREVIEW_BASE:-}");
    assert.equal(build.labels["com.bthwani.preview-digest"], "${BTHWANI_BUILD_PREVIEW_DIGEST:-}");
  }
});
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
  assert.deepEqual(Object.keys(base.services).sort(), ["dsh","dsh-bootstrap","identity","mailpit","media","payment-mock","postgres","wlt"]);
  assert.deepEqual(Object.keys(base.services).filter(name=>!base.services[name].profiles?.length).sort(), ["mailpit","media","payment-mock","postgres"]);
});

test("serving containers share one canonical environment-label definition", () => {
  const model = compose("compose.yaml");
  const source = readFileSync(path.join(infra, "compose.yaml"), "utf8");
  for (const name of ["postgres", "mailpit", "media", "payment-mock", "dsh", "identity", "wlt"]) {
    const labels = model.services[name].labels;
    assert.equal(labels["com.bthwani.environment"], model["x-labels"]["com.bthwani.environment"], name);
    assert.equal(labels["com.bthwani.worktree"], model["x-labels"]["com.bthwani.worktree"], name);
  }
  assert.equal([...source.matchAll(/^\s+com\.bthwani\.worktree:/gm)].length, 1);
  assert.equal(model.services.dsh.labels["com.bthwani.capability"], "customer-store-catalog");
  assert.equal(model.services.identity.labels["com.bthwani.capability"], "identity-synthetic-session-verifier");
  assert.equal(model.services.wlt.labels["com.bthwani.capability"], "customer-wallet-read-only");
});

test("WLT is the real isolated read-only owner and never a migration service", () => {
  const wlt = compose("compose.yaml").services.wlt;
  assert.deepEqual(wlt.profiles, ["implementation"]);
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
    "${REF_WLT_TEST_DATABASE_URL:-}");
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
  const apps = compose("compose.yaml");
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
  assert.equal(service.environment.REF_POSTGRES_USER, "${REF_DSH_RUNTIME_USER:-}");
  assert.equal(service.environment.REF_POSTGRES_PASSWORD, "${REF_DSH_RUNTIME_PASSWORD:-}");
  assert.equal(service.environment.REF_POSTGRES_DB, "${REF_DSH_RUNTIME_DATABASE:-}");
  assert.equal(bootstrap.environment.REF_POSTGRES_USER, "${REF_DSH_BOOTSTRAP_USER:-}");
  assert.equal(bootstrap.environment.REF_POSTGRES_PASSWORD, "${REF_DSH_BOOTSTRAP_PASSWORD:-}");
  assert.equal(service.environment.DSH_IDENTITY_VERIFIER_URL, "https://identity:3343");
  assert.equal(service.environment.DSH_ENABLE_ISOLATED_CUSTOMER_CART, "${REF_DSH_ENABLE_ISOLATED_CUSTOMER_CART:-false}");
  assert.equal(service.environment.DSH_ENABLE_ISOLATED_EMPLOYEES, "${REF_DSH_ENABLE_ISOLATED_EMPLOYEES:-false}", "Employee directory must require explicit isolated opt-in");
  assert.equal(service.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(service.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
});

test("Identity verifier is synthetic only and has no privileged host exposure", () => {
  const id = compose("compose.yaml").services.identity;
  assert.deepEqual(id.profiles, ["implementation"]);
  assert.equal(id.restart, "unless-stopped", "Identity must recover after Docker engine restart");
  assert.equal(id.read_only, true);
  assert.ok(id.cap_drop.includes("ALL"));
  assert.equal(id.environment.BTHWANI_ISOLATED_TEST_MODE, "true");
  assert.equal(id.environment.BTHWANI_ISOLATED_CONTAINER_MODE, "true");
  assert.equal(id.environment.IDENTITY_TEST_DATABASE_URL, "${REF_IDENTITY_RUNTIME_DATABASE_URL:-}");
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

test("owner admission and private trust stay in one environment, default off", () => {
  const model = compose("compose.yaml");
  const {dsh, identity} = model.services;
  const variable=(key, value="")=>"$"+"{"+key+":-"+value+"}";
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_MERCHANT_STANDING,variable("REF_DSH_ENABLE_ISOLATED_MERCHANT_STANDING","false"));
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_STANDING,variable("REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING","false"));
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST,variable("REF_DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST","false"));
  assert.equal(dsh.environment.DSH_ENABLE_ISOLATED_STORE_AVAILABILITY,variable("REF_DSH_ENABLE_ISOLATED_STORE_AVAILABILITY","false"));
  assert.equal(identity.environment.IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION,variable("REF_IDENTITY_CAPTAIN_ADMISSION","false"));
  assert.equal(dsh.environment.DSH_IDENTITY_VERIFIER_URL,"https://identity:3343");
  assert.equal(dsh.environment.SSL_CERT_FILE,"/run/identity-ca/ca.pem");
  assert.equal(identity.environment.IDENTITY_ISOLATED_VERIFIER_TLS_CERT,"/run/identity-tls/server.pem");
  assert.equal(identity.environment.IDENTITY_ISOLATED_VERIFIER_TLS_KEY,"/run/identity-tls/server-key.pem");
  assert.equal(identity.environment.IDENTITY_DSH_CAPTAIN_STANDING_URL,"https://dsh:3344");
  assert.equal(identity.environment.IDENTITY_DSH_CAPTAIN_STANDING_CA,"/run/dsh-captain-ca/ca.pem");
  assert.equal(dsh.environment.DSH_ISOLATED_CAPTAIN_TLS_CERT,variable("REF_DSH_PRIVATE_TLS_CERT"));
  assert.equal(dsh.environment.DSH_ISOLATED_CAPTAIN_TLS_KEY,variable("REF_DSH_PRIVATE_TLS_KEY"));
  assert.deepEqual(dsh.volumes,["merchant-identity-ca:/run/identity-ca:ro","captain-dsh-tls:/run/dsh-captain-tls:ro"]);
  assert.deepEqual(identity.volumes,["merchant-identity-tls:/run/identity-tls:ro","captain-dsh-ca:/run/dsh-captain-ca:ro"]);
  for(const name of ["merchant-identity-ca","merchant-identity-tls","captain-dsh-ca","captain-dsh-tls"]){
    assert.deepEqual(model.volumes[name],{name:"bthwani-refoundation-"+name,external:true});
  }
  for(const owner of [dsh,identity]) assert.ok(owner.ports.every(port=>port.startsWith("127.0.0.1:")&&!/:(3343|3344)$/.test(port)));
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
  assert.deepEqual([...ownerComposeInputs].sort(), allowed, "runtime input scope must match the single canonical definition");
  assert.deepEqual(files, allowed, "application/capability Compose files are forbidden");
});
