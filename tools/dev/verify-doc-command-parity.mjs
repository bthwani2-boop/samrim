import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const docsRoot = path.join(repoRoot, "docs");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const scripts = new Set(Object.keys(packageJson.scripts ?? {}));

const pnpmBuiltins = new Set([
  "add",
  "config",
  "create",
  "deploy",
  "dlx",
  "env",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "list",
  "ls",
  "pack",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "setup",
  "store",
  "update",
  "up",
  "why",
]);

const forbiddenLegacyPatterns = [
  { label: "legacy mobile wrapper", regex: /tools\/mobile\/mobile\.ps1/i },
  { label: "legacy app runtime wrapper wording", regex: /app runtime wrappers?/i },
  { label: "stale LeanCTX repository policy path", regex: /\.agents\/tools\/leanctx\.md/i },
  { label: "stale LeanCTX adapter path", regex: /\bLEAN-CTX\.md\b/i },
  { label: "stale agent routing index", regex: /\.agents\/INDEX\.md/i },
  { label: "stale LeanCTX tracked config", regex: /\.lean-ctx(?:\.toml|-id)\b/i },
  { label: "donor-specific reference pin", regex: /PIN_LIVE_h/i },
  { label: "legacy full runtime command", regex: /runtime:full(?::smoke)?/i },
  { label: "legacy verify full command", regex: /verify:full/i },
  { label: "legacy reverse wrapper", regex: /\bpnpm\s+reverse\b/i },
  { label: "legacy mobile eas wrapper", regex: /\bpnpm\s+mobile:eas\b/i },
  {
    label: "donor repository path",
    regex: new RegExp("bthwani-suite" + "-next", "i"),
  },
  {
    label: "donor branch authority",
    regex: new RegExp("\\borigin" + "\\/h\\b", "i"),
  },
  {
    label: "wrong diagnosis-plan authority",
    regex: /plans\/diagnose-implementing/i,
  },
];

function collectMarkdownFiles(root) {
  const files = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolute));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolute);
    }
  }

  return files;
}

const failures = [];

const documentationFiles = [
  ...collectMarkdownFiles(docsRoot),
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "CONTRIBUTING.md"),
  path.join(repoRoot, "AGENTS.md"),
  path.join(repoRoot, "tools", "README.md"),
].filter((file, index, all) => fs.existsSync(file) && all.indexOf(file) === index);

for (const file of documentationFiles) {
  const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
  const lines = fs.readFileSync(file, "utf8").split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const pattern of forbiddenLegacyPatterns) {
      if (pattern.regex.test(line)) {
        failures.push(
          relative +
            ":" +
            lineNumber +
            " -> " +
            pattern.label +
            ": " +
            line.trim(),
        );
      }
    }

    if (/\bpnpm\s+--dir\b/.test(line)) {
      return;
    }

    for (const match of line.matchAll(
      /\bpnpm\s+(?:run\s+)?([A-Za-z0-9][A-Za-z0-9:_-]*)/g,
    )) {
      const command = match[1];

      if (pnpmBuiltins.has(command)) {
        continue;
      }

      if (!scripts.has(command)) {
        failures.push(
          relative +
            ":" +
            lineNumber +
            " -> undocumented root command authority: pnpm " +
            command,
        );
      }
    }
  });
}

if (failures.length > 0) {
  console.error("DOC_COMMAND_PARITY=FAIL");

  for (const failure of failures) {
    console.error("  " + failure);
  }

  process.exit(1);
}

console.log("DOC_COMMAND_PARITY=PASS");
