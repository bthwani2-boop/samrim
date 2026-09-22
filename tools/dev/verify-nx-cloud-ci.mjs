import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nxConfigPath = path.join(repositoryRoot, "nx.json");

function fail(message) {
  console.error(`NX_CLOUD_CI_VERIFY=FAIL ${message}`);
  process.exitCode = 1;
}

const nxConfig = JSON.parse(fs.readFileSync(nxConfigPath, "utf8"));
if (typeof nxConfig.nxCloudId !== "string" || nxConfig.nxCloudId.trim() === "") {
  fail("nx.json does not contain nxCloudId");
}

const token = process.env.NX_CLOUD_ACCESS_TOKEN?.trim() ?? "";
if (token === "") {
  fail(
    "NX_CLOUD_ACCESS_TOKEN is unavailable. Configure the read-only NX_CLOUD_RO_TOKEN repository secret for pull requests, or the protected NX_CLOUD_RW_TOKEN environment secret for main.",
  );
}

if (process.exitCode) {
  process.exit();
}

console.log("NX_CLOUD_CI_VERIFY=PASS");
console.log("NX_CLOUD_WORKSPACE_ID=present");
console.log("NX_CLOUD_ACCESS_TOKEN=present");
