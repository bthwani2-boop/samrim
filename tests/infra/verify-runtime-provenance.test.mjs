import assert from "node:assert/strict";
import test from "node:test";
import { main, verifyCandidate } from "../../tools/dev/docker/verify-runtime-provenance.mjs";

const head = "a".repeat(40);
const successor = "b".repeat(40);
const ownerNames = ["dsh", "identity", "wlt"];
const args = ["--context", "bthwani-docker"];
const label = value => value || "<no value>";
const name = owner => "bthwani-refoundation-" + owner + "-1";

function fixture(options = {}) {
  const calls = [];
  let sourceReads = 0, containerReads = 0;
  const imageFor = owner => "sha256:" + String(ownerNames.indexOf(owner) + 1).repeat(64);
  const containerFor = (owner, pass) => {
    const o = {
      id: String(ownerNames.indexOf(owner) + 4).repeat(64),
      name: "/" + name(owner), image: imageFor(owner), project: "bthwani-refoundation",
      service: owner, environment: "refoundation",
      capability: owner === "wlt" ? "customer-wallet-read-only" : "",
      running: "true", state: "running", health: "healthy",
      startedAt: "2026-11-26T02:00:00.123456789Z", restartCount: "0",
      ...options.containers?.[owner], ...(pass === 2 ? options.finalContainers?.[owner] : {}),
    };
    return [o.id, o.name, o.image, o.project, o.service, o.environment, label(o.capability),
      o.running, o.state, o.health, o.startedAt, o.restartCount].join("|");
  };
  const imageForOwner = owner => {
    const o = { id: imageFor(owner), revision: head, source: head, previewBase: "", previewDigest: "",
      ...options.images?.[owner] };
    return [o.id, label(o.revision), label(o.source), label(o.previewBase), label(o.previewDigest)].join("|");
  };
  const execute = (command, a) => {
    calls.push([command, ...a]);
    if (command === "docker" && a[0] === "context") return options.context ?? "ssh://user@bthwani-docker";
    if (command === "git") {
      if (a[0] === "rev-parse") return ++sourceReads === 2 ? options.finalHead ?? head : options.head ?? head;
      if (a[0] === "branch") return sourceReads === 2 ? options.finalBranch ?? "development" : options.branch ?? "development";
      if (a[0] === "status") return sourceReads === 2 ? options.finalStatus ?? options.status ?? "" : options.status ?? "";
      if (a[0] === "diff") {
        const owner = a.find(part => part.startsWith("services/")).split("/")[1];
        return (options.changes?.[owner] ?? []).map(path => path + "\0").join("");
      }
    }
    if (command === "docker" && a[0] === "--context" && a[1] === "bthwani-docker") {
      if (a[2] === "inspect") {
        containerReads++;
        if (options.badContainer === "malformed") return "bad";
        const list = options.badContainer === "missing" ? ownerNames.slice(0, 2) :
          options.badContainer === "duplicate" ? ["dsh", "identity", "dsh"] : ownerNames;
        return list.map(owner => containerFor(owner, containerReads)).join("\r\n");
      }
      if (a[2] === "image" && a[3] === "inspect") {
        if (options.badImage === "malformed") return "bad";
        const list = options.badImage === "missing" ? ownerNames.slice(0, 2) :
          options.badImage === "duplicate" ? ["dsh", "identity", "dsh"] : ownerNames;
        return list.map(imageForOwner).join("\r\n");
      }
    }
    throw new Error("unexpected verification command");
  };
  return {
    calls, execute,
    ancestor: (revision, candidate) => {
      assert.match(revision, /^[0-9a-f]{40}$/);
      assert.equal(candidate, options.head ?? head);
      return options.ancestor ?? true;
    },
  };
}

function run(options, preflight = false) {
  const f = fixture(options);
  const result = verifyCandidate(preflight ? [...args, "--start-preflight"] : args, f.execute, f.ancestor);
  return { ...f, result };
}

function rejectOwner(options, owner = "dsh", reason, preflight = false) {
  const { result } = run(options, preflight);
  assert.equal(result.passed, false);
  const row = result.results.find(r => r.owner === owner);
  assert.equal(row.passed, false);
  if (reason) assert.ok(row.errors.some(e => e.includes(reason)), row.errors.join("; "));
}

test("one committed candidate checks all three actual owner names and rechecks the same window", () => {
  const { result, calls } = run();
  assert.equal(result.head, head);
  assert.equal(result.passed, true);
  assert.deepEqual(result.results.map(r => r.owner), ownerNames);
  const snapshots = calls.filter(c => c[0] === "docker" && c[3] === "inspect");
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.slice(-3), ownerNames.map(name));
    assert.ok(snapshot.includes("--format"));
    assert.ok(!snapshot.join(" ").includes(".Config.Env"));
  }
  const images = calls.filter(c => c[0] === "docker" && c[3] === "image");
  assert.equal(images.length, 1);
  assert.equal(images[0].slice(-3).length, 3);
  const statuses = calls.filter(c => c[0] === "git" && c[1] === "status");
  assert.equal(statuses.length, 2);
  for (const status of statuses) {
    assert.ok(status.includes("--untracked-files=all"));
    assert.ok(status.includes("-z"));
    assert.ok(status.includes("--no-renames"));
    assert.deepEqual(status.slice(-3), ownerNames.map(o => "services/" + o));
  }
  const diffs = calls.filter(c => c[0] === "git" && c[1] === "diff");
  assert.equal(diffs.length, 3);
  assert.deepEqual(diffs.map(d => d.at(-1)), ownerNames.map(o => "services/" + o));
  assert.ok(diffs.every(d => d.includes("-z") && d.includes("--no-renames")));
});

test("a HEAD or branch change cannot print a successful attestation for a superseded candidate", () => {
  for (const change of [{ finalHead: successor }, { finalBranch: "different-branch" }]) {
    const f = fixture(change);
    assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
  }
});

test("owner changes appearing during attestation invalidate the candidate", () => {
  const f = fixture({ finalStatus: "?? services/dsh/backend/internal/new.go\0" });
  assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
});

test("replacement or restart of a serving container invalidates the entire snapshot", () => {
  for (const changes of [
    { id: "9".repeat(64) },
    { image: "sha256:" + "9".repeat(64) },
    { restartCount: "1" },
    { startedAt: "2026-11-26T02:05:00Z" },
    { health: "unhealthy" },
  ]) {
    const f = fixture({ finalContainers: { wlt: changes } });
    assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
  }
});

test("changed Go, SQL, contract and Docker inputs reject owner parity; committed non-runtime inputs do not", () => {
  for (const owner of ownerNames) {
    const p = "services/" + owner + "/";
    const nonRuntime = [p + "backend/cmd/" + owner + "/main_test.go", p + "README.md",
      p + "backend/README.md", p + "clients/public-client.ts"];
    for (const preflight of [false, true]) {
      assert.equal(run({ changes: { [owner]: nonRuntime } }, preflight).result.passed, true);
      for (const path of [p + "backend/cmd/" + owner + "/main.go", p + "database/schema/00.sql",
        p + "contracts/openapi/" + owner + ".openapi.yaml", p + ".dockerignore"]) {
        rejectOwner({ changes: { [owner]: [...nonRuntime, path] } }, owner, "owner source changed", preflight);
      }
    }
  }
});

test("dirty owner files including untracked files fail even if the image labels match", () => {
  for (const status of [" M services/identity/backend/main.go\0", "?? services/identity/backend/untracked.go\0"]) {
    rejectOwner({ status }, "identity", "owner worktree is not clean");
  }
  rejectOwner({ ancestor: false }, "dsh", "source is not an ancestor");
  const { calls } = run({ ancestor: false });
  assert.ok(!calls.some(c => c[0] === "git" && c[1] === "diff"));
});

test("unknown or contradictory image provenance and previews fail closed", () => {
  for (const changes of [
    { revision: "", source: "" },
    { revision: "unsafe", source: "" },
    { revision: head, source: successor },
    { revision: head, previewBase: head },
    { revision: head, previewDigest: "f".repeat(64) },
    { revision: head, previewBase: head, previewDigest: "f".repeat(64) },
    { revision: "worktree-" + "f".repeat(64), source: "", previewBase: head, previewDigest: "f".repeat(64) },
  ]) rejectOwner({ images: { dsh: changes } });
  const { calls } = run({ images: { dsh: { revision: "unsafe", source: "" } } });
  assert.ok(!calls.some(c => c[0] === "git" && c[1] === "diff" && c.at(-1) === "services/dsh"));
});

test("a healthy-looking foreign container and wrong WLT capability are rejected", () => {
  for (const changes of [{ project: "donor" }, { service: "identity" }, { environment: "production" }, { environment: "" }]) {
    rejectOwner({ containers: { dsh: changes } }, "dsh", "not the expected isolated");
  }
  rejectOwner({ containers: { wlt: { capability: "other" } } }, "wlt", "not the expected isolated");
});

test("unhealthy, stopped, contradictory, or malformed lifecycle metadata is not acceptance", () => {
  for (const changes of [{ health: "NOT_CONFIGURED" }, { health: "unhealthy" },
    { running: "false", state: "exited" }, { running: "true", state: "exited" }]) {
    rejectOwner({ containers: { dsh: changes } }, "dsh", "container state or health not proven");
  }
  for (const changes of [{ id: "" }, { image: "sha256:invalid" }, { running: "unknown" },
    { startedAt: "" }, { restartCount: "invalid" }]) {
    assert.throws(() => run({ containers: { dsh: changes } }), /invalid container identity or lifecycle metadata/);
  }
});

test("missing, duplicate, or malformed owner/image records block the whole candidate", () => {
  for (const bad of ["missing", "duplicate", "malformed"]) {
    assert.throws(() => run({ badContainer: bad }), /(?:missing|unexpected) container metadata/);
    assert.throws(() => run({ badImage: bad }), /(?:missing|unexpected) image metadata/);
  }
  assert.throws(() => run({ images: { dsh: { id: "sha256:" + "9".repeat(64) } } }), /unexpected image metadata/);
});

test("startup preflight admits only previously exited isolated owners and checks Compose source", () => {
  const exited = { running: "false", state: "exited", health: "unhealthy" };
  rejectOwner({ containers: { dsh: exited } });
  assert.equal(run({ containers: { dsh: exited } }, true).result.passed, true);
  for (const changes of [{ state: "created" }, { state: "dead" }, { health: "NOT_CONFIGURED" },
    { running: "true", state: "running" }]) {
    rejectOwner({ containers: { dsh: { ...exited, ...changes } } }, "dsh", undefined, true);
  }
  const { calls } = run({}, true);
  assert.ok(calls.filter(c => c[0] === "git" && ["status", "diff"].includes(c[1]))
    .every(c => c.includes("infra/compose.yaml")));
  rejectOwner({ status: " M infra/compose.yaml\0" }, "wlt", "owner worktree is not clean", true);
  rejectOwner({ changes: { dsh: ["infra/compose.yaml"] } }, "dsh", "owner source changed", true);
  assert.throws(() => run({ branch: "archive/legacy" }, true), /source candidate not verified/);
});

test("invalid command arguments or non-approved Docker endpoints are rejected before owner reads", () => {
  for (const bad of [["--context"], ["--once"], ["--include-wlt"], [...args, "--include-wlt"],
    [...args, "--start-preflight", "--start-preflight"]]) assert.throws(() => main(bad), /Usage/);
  for (const context of ["../unsafe", "a;whoami", "default"]) {
    assert.throws(() => main(["--context", context]), /invalid Docker context/);
  }
  for (const context of ["npipe:////./pipe/docker_engine", "ssh://user@other", "ssh://user@bthwani-docker/"]) {
    assert.throws(() => run({ context }), /Wrong Docker target/);
  }
  assert.throws(() => run({ head: "invalid" }), /source candidate not verified/);
});
