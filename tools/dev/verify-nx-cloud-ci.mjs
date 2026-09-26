import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nxConfigPath = path.join(repositoryRoot, "nx.json");

function fail(message) {
  console.error("NX_CLOUD_CI_VERIFY=FAIL " + message);
  process.exitCode = 1;
}

const nxConfig = JSON.parse(fs.readFileSync(nxConfigPath, "utf8"));
if (typeof nxConfig.nxCloudId !== "string" || nxConfig.nxCloudId.trim() === "") {
  fail("nx.json does not contain nxCloudId");
}

const token = process.env.NX_CLOUD_ACCESS_TOKEN?.trim() ?? "";
const noCloud = process.env.NX_NO_CLOUD === "true";
const eventName = process.env.GITHUB_EVENT_NAME ?? "";

if (noCloud) {
  if (eventName !== "pull_request") fail("NX_NO_CLOUD is allowed only for pull_request runs without trusted cache credentials");
  if (token) fail("NX_NO_CLOUD and NX_CLOUD_ACCESS_TOKEN must not be enabled together");
} else if (!token) {
  fail("trusted CI requires NX_CLOUD_ACCESS_TOKEN; use read-only credentials for PRs and protected write credentials for main");
}

if (process.exitCode) process.exit();

console.log("NX_CLOUD_CI_VERIFY=PASS");
console.log("NX_CLOUD_WORKSPACE_ID=present");
console.log("NX_CLOUD_MODE=" + (noCloud ? "local-only-untrusted-pr" : "authenticated"));
console.log("NX_CLOUD_ACCESS_TOKEN=" + (token ? "present" : "absent-by-policy"));
