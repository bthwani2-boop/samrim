// Disposable synthetic provider contract probe. Never target a shared Compose
// service, follow a redirect, or treat a transport failure as a provider deadline.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const loopback = "127.0.0.1";
const root = fileURLToPath(new URL("./", import.meta.url));
const funding = "/sandbox/v1/funding/";
const accepted = "cash-in-accepted-01";
const delayed = "cash-in-delayed-01";

export async function requestFunding(port, reference, timeout = 6000) {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "PAYMENT_PORT_INVALID");
  assert.match(reference, /^[a-z0-9-]+$/, "PAYMENT_REFERENCE_INVALID");
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let connected = false;
    let receiving = false;
    let timer;
    function fail(error) {
      clearTimeout(timer);
      reject(error);
    }
    const request = get({ hostname: loopback, port, path: funding + reference, family: 4, agent: false }, response => {
      receiving = true;
      const chunks = [];
      let length = 0;
      response.on("data", chunk => {
        length += chunk.length;
        if (length > 64 * 1024) {
          request.destroy(new Error("PAYMENT_RESPONSE_TOO_LARGE"));
        } else {
          chunks.push(chunk);
        }
      });
      response.on("error", fail);
      response.on("end", () => {
        clearTimeout(timer);
        if (!response.complete) {
          reject(new Error("PAYMENT_RESPONSE_INCOMPLETE"));
          return;
        }
        resolve({ status: response.statusCode, headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"), elapsed: performance.now() - started });
      });
    });
    request.on("socket", socket => {
      if (socket.connecting) socket.once("connect", () => { connected = true; });
      else connected = socket.remoteAddress === loopback;
    });
    request.on("error", fail);
    timer = setTimeout(() => {
      const code = connected && !receiving ? "PAYMENT_CONNECTED_TIMEOUT" : "PAYMENT_REQUEST_TIMEOUT";
      const error = Object.assign(new Error(code), { code });
      fail(error);
      request.destroy(error);
    }, timeout);
  });
}

function fixtureCases() {
  const directory = join(root, "mappings");
  const cases = readdirSync(directory).filter(file => file.endsWith(".json")).sort().map(file => {
    const mapping = JSON.parse(readFileSync(join(directory, file), "utf8"));
    const reference = mapping.response.jsonBody.reference;
    assert.equal(mapping.request.url, funding + reference, "PAYMENT_FIXTURE_PATH");
    assert.equal(mapping.request.method, "GET", "PAYMENT_FIXTURE_METHOD");
    return [reference, mapping.response];
  });
  const result = new Map(cases);
  assert.equal(cases.length, 9, "PAYMENT_FIXTURE_COUNT");
  assert.equal(result.size, cases.length, "PAYMENT_FIXTURE_DUPLICATE");
  assert.ok(result.has(accepted) && result.has(delayed), "PAYMENT_FIXTURE_MISSING");
  return result;
}

function verifyResponse(actual, expected, reference) {
  assert.equal(actual.status, expected.status, "PAYMENT_STATUS " + reference);
  for (const [key, value] of Object.entries(expected.headers)) {
    assert.equal(actual.headers[key.toLowerCase()], value, "PAYMENT_HEADER " + reference + " " + key);
  }
  assert.equal(actual.headers.location, expected.headers.Location, "PAYMENT_REDIRECT " + reference);
  assert.deepEqual(JSON.parse(actual.body), expected.jsonBody, "PAYMENT_BODY " + reference);
  if (expected.fixedDelayMilliseconds) {
    assert.ok(actual.elapsed >= expected.fixedDelayMilliseconds - 100, "PAYMENT_DELAY " + reference);
  }
}

async function waitForProvider(port) {
  const deadline = performance.now() + 30000;
  for (;;) {
    try {
      return await requestFunding(port, accepted, 2000);
    } catch (error) {
      if (performance.now() >= deadline ||
          !["ECONNREFUSED", "ECONNRESET", "PAYMENT_REQUEST_TIMEOUT", "PAYMENT_CONNECTED_TIMEOUT"].includes(error.code)) {
        throw error;
      }
      await sleep(250);
    }
  }
}

export async function verifyProvider(port) {
  const cases = fixtureCases();
  verifyResponse(await waitForProvider(port), cases.get(accepted), accepted);
  for (const [reference, expected] of cases) {
    if (reference !== accepted) verifyResponse(await requestFunding(port, reference), expected, reference);
  }
  assert.equal((await requestFunding(port, "cash-in-not-configured")).status, 404, "PAYMENT_MISSING_STATUS");
  await assert.rejects(requestFunding(port, delayed, 1000), { code: "PAYMENT_CONNECTED_TIMEOUT" });
  verifyResponse(await requestFunding(port, accepted), cases.get(accepted), accepted);
}

function docker(args, timeout = 30000) {
  return execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout }).trim();
}

async function runDockerSmoke() {
  const context = docker(["context", "show"]);
  const endpoint = docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
  assert.match(endpoint, /^(unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/, "PAYMENT_DOCKER_MUST_BE_LOCAL");
  const run = (args, timeout) => docker(["--context", context, ...args], timeout);
  const token = randomUUID();
  const name = "bthwani-payment-mock-ci-" + token;
  const image = "bthwani-payment-mock-ci:" + token;
  const label = "com.bthwani.smoke-run";
  const containers = () => run(["container", "ls", "-aq", "--no-trunc", "--filter", "name=^/" + name + "$"]);
  const images = () => run(["image", "ls", "-q", "--no-trunc", "--filter", "reference=" + image]);
  assert.equal(containers(), "", "PAYMENT_CONTAINER_ALREADY_EXISTS");
  assert.equal(images(), "", "PAYMENT_IMAGE_ALREADY_EXISTS");
  try {
    run(["build", "--file", join(root, "Dockerfile"), "--tag", image, root], 180000);
    const imageId = run(["image", "inspect", "--format", "{{.Id}}", image]);
    assert.match(imageId, /^sha256:[a-f0-9]{64}$/, "PAYMENT_IMAGE_ID");
    const container = run(["run", "--rm", "-d", "--name", name, "--label", label + "=" + token,
      "--publish", loopback + "::8080", image]);
    assert.match(container, /^[a-f0-9]{64}$/, "PAYMENT_CONTAINER_ID");
    assert.equal(containers(), container, "PAYMENT_CONTAINER_IDENTITY");
    assert.equal(run(["container", "inspect", "--format", "{{.Image}}", container]), imageId, "PAYMENT_CONTAINER_IMAGE");
    assert.equal(run(["exec", container, "id", "-u"]), "1000", "PAYMENT_CONTAINER_USER");
    const binding = run(["port", container, "8080/tcp"]);
    const port = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    assert.ok(port, "PAYMENT_CONTAINER_LOOPBACK");
    await verifyProvider(Number(port[1]));
  } finally {
    // Read back exact ownership even if a native operation timed out; never
    // replay a launch or remove shared services/images by a broad selector.
    const owned = containers();
    if (owned) {
      assert.match(owned, /^[a-f0-9]{64}$/, "PAYMENT_CLEANUP_CONTAINER_ID");
      const labels = JSON.parse(run(["container", "inspect", "--format", "{{json .Config.Labels}}", owned]));
      assert.equal(labels[label], token, "PAYMENT_CLEANUP_OWNER");
      run(["container", "rm", "-f", owned]);
    }
    assert.equal(containers(), "", "PAYMENT_CONTAINER_RETAINED");
    if (images()) run(["image", "rm", "--no-prune", image]);
    assert.equal(images(), "", "PAYMENT_IMAGE_RETAINED");
  }
  console.log("PAYMENT_MOCK_DOCKER_SMOKE_PASS local_only=true synthetic_only=true cases=9 missing=404 connected_timeout=true recovery=true");
}

if (import.meta.main) await runDockerSmoke();
