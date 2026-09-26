import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const service = process.argv[2];
const definitions = {
  identity: { dockerfile: "services/identity/backend/Dockerfile", tag: "samrim-local-identity:dev" },
  dsh: { dockerfile: "services/dsh/backend/Dockerfile", tag: "samrim-local-dsh:dev" },
  wlt: { dockerfile: "services/wlt/backend/Dockerfile", tag: "samrim-local-wlt:dev" },
};

if (process.env.CI !== "true") {
  console.error("CI_IMAGE_BUILD=FAIL disposable CI environment required");
  process.exit(1);
}
const definition = definitions[service];
if (!definition) {
  console.error("CI_IMAGE_BUILD=FAIL unsupported service=" + String(service));
  process.exit(1);
}

const scope = "samrim-" + service;
const trustedCacheWriter = process.env.GITHUB_EVENT_NAME !== "pull_request";
const args = [
  "buildx", "build",
  "--load",
  "--provenance=false",
  "--cache-from", "type=gha,scope=" + scope,
  "--file", definition.dockerfile,
  "--tag", definition.tag,
];
if (trustedCacheWriter) args.push("--cache-to", "type=gha,mode=max,scope=" + scope);
args.push(".");

console.log("CI_IMAGE_BUILD_START service=" + service + " scope=" + scope + " cache_write=" + trustedCacheWriter);
execFileSync("docker", args, { cwd: root, env: process.env, stdio: "inherit" });
console.log("CI_IMAGE_BUILD=PASS service=" + service + " tag=" + definition.tag);
