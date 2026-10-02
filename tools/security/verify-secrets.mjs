import { execFileSync, spawnSync } from "node:child_process";

const root = process.cwd();
const event = process.env.GITHUB_EVENT_NAME || "";
const prBase = process.env.PR_BASE_SHA || "";
const pushBefore = process.env.PUSH_BEFORE_SHA || "";
const prHead = process.env.PR_HEAD_SHA || "";
const githubSha = process.env.GITHUB_SHA || "";

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function grepAt(ref = null) {
  const pattern = [
    ["-----BEGIN ", "(RSA |EC |OPENSSH )?", "PRIVATE KEY-----"].join(""),
    ['"private_', 'key"[[:space:]]*:'].join(""),
    ["gh", "[pousr]_", "[A-Za-z0-9_]{20,}"].join(""),
    ["github_", "pat_", "[A-Za-z0-9_]{20,}"].join("")
  ].join("|");
  const args = ["grep", "-n", "-I", "-E", "--", pattern];
  if (ref) args.push(ref);
  args.push("--", ".");
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  if (result.status === 1) return "";
  throw new Error(result.stderr || "git grep failed");
}

const badNamePattern = /(^|\/)(credentials\.json|google-services\.json|GoogleService-Info\.plist)$|\.(jks|keystore|p12|p8|pem|key)$|(^|\/)\.env($|\.)/i;
const badNames = git(["ls-files"]).split(/\r?\n/).filter(Boolean).filter((file) => badNamePattern.test(file) && !/(^|\/)\.env\.example$/i.test(file));
if (badNames.length) {
  console.error("SECRET_SAFETY=FAIL forbidden tracked filenames");
  for (const file of badNames) console.error("  " + file);
  process.exit(1);
}

const currentMatches = grepAt();
if (currentMatches) {
  console.error("SECRET_SAFETY=FAIL current candidate contains secret markers");
  console.error(currentMatches);
  process.exit(1);
}

let commits = [];
if (event === "schedule" || event === "workflow_dispatch") {
  commits = git(["rev-list", "--all"]).split(/\r?\n/).filter(Boolean);
} else if (event === "pull_request" && prBase && prHead) {
  commits = git(["rev-list", `${prBase}..${prHead}`]).split(/\r?\n/).filter(Boolean);
} else if (pushBefore && pushBefore !== "0000000000000000000000000000000000000000" && githubSha) {
  commits = git(["rev-list", `${pushBefore}..${githubSha}`]).split(/\r?\n/).filter(Boolean);
} else if (githubSha) {
  execFileSync("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"], { cwd: root, stdio: "inherit" });
  const base = git(["merge-base", githubSha, "refs/remotes/origin/main"]);
  commits = git(["rev-list", `${base}..${githubSha}`]).split(/\r?\n/).filter(Boolean);
}

for (const commit of commits) {
  const matches = grepAt(commit);
  if (matches) {
    console.error(`SECRET_SAFETY=FAIL introduced secret marker commit=${commit}`);
    console.error(matches);
    process.exit(1);
  }
}
console.log(`SECRET_SAFETY=PASS commits_scanned=${commits.length}`);
