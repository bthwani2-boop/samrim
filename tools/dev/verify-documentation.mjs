import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

{
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const knowledgeRoot = ensureKnowledgeRoot({ materialize: false });
  const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");
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
    { label: "legacy foundation runtime command", regex: /\b(?:foundation:|runtime:foundation:)\S*/i },
    {
      label: "legacy foundation compose profile",
      regex: new RegExp("--pro" + String.raw`file\s+foundation\b`, "i"),
    },
    { label: "legacy verify full command", regex: /verify:full/i },
    { label: "legacy reverse wrapper", regex: /\bpnpm\s+reverse\b/i },
    { label: "legacy mobile eas wrapper", regex: /\bpnpm\s+mobile:eas\b/i },
    {
      label: "donor repository path",
      regex: new RegExp("bthwani-suite" + "-next", "i"),
    },
    {
      label: "donor branch authority",
      regex: new RegExp(String.raw`\b${["origin", "h"].join("/")}\b`, "i"),
    },
    {
      label: "wrong diagnosis-plan authority",
      regex: /plans\/diagnose-implementing/i,
    },
  ];

  function collectMarkdownFiles(root) {
    if (!fs.existsSync(root)) return [];
    const files = [];
    const ignoredDirectories = new Set([
      ".git",
      ".graphify",
      ".kilo",
      ".nx",
      ".tmp",
      ".cache",
      "graphify-out",
      "node_modules",
    ]);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...collectMarkdownFiles(absolute));
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
    }
    return files;
  }

  function displayPath(file) {
    const knowledgeRel = path.relative(knowledgeRoot, file);
    if (!knowledgeRel.startsWith("..") && !path.isAbsolute(knowledgeRel)) {
      return "knowledge:" + knowledgeRel.replaceAll("\\", "/");
    }
    return path.relative(repoRoot, file).replaceAll("\\", "/");
  }

  function resolveRepositoryPath(candidate) {
    const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
    if (normalized.startsWith("governance/") || normalized.startsWith("docs/")) {
      return path.join(knowledgeRoot, ...normalized.split("/"));
    }
    return path.join(repoRoot, ...normalized.split("/"));
  }

  function trimReferencePunctuation(value) {
    let end = value.length;
    while (end > 0 && ".,;:".includes(value[end - 1])) end -= 1;
    const trimmed = value.slice(0, end);
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }

  const failures = [];
  const documentationFiles = [
    ...collectMarkdownFiles(repoRoot).filter((file) => {
      const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
      return !relative.startsWith(".git/") &&
        relative !== "REPOSITORY-STRUCTURE.md" &&
        !relative.startsWith(".cache/") &&
        !relative.startsWith("node_modules/") &&
        !relative.startsWith(".kilo/") &&
        !relative.startsWith(".nx/") &&
        !relative.startsWith(".tmp/");
    }),
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "CONTRIBUTING.md"),
    path.join(repoRoot, "AGENTS.md"),
    path.join(repoRoot, "SECURITY.md"),
    path.join(repoRoot, "tools", "README.md"),
  ].filter((file, index, all) => fs.existsSync(file) && all.indexOf(file) === index);

  function recordForbiddenLegacy(line, relative, lineNumber) {
    for (const pattern of forbiddenLegacyPatterns) {
      if (!pattern.regex.test(line)) continue;
      failures.push(relative + ":" + lineNumber + " -> " + pattern.label + ": " + line.trim());
    }
  }

  function recordMissingRepositoryPaths(line, relative, lineNumber) {
    if (relative === "knowledge:docs/reference/donor.md") return;
    for (const codeMatch of line.matchAll(/`([^`]+)`/g)) {
      const code = codeMatch[1];
      for (const match of code.matchAll(
        /\b(?:governance|docs|tools|apps|services|packages|infra)\/[A-Za-z0-9._@+/-]+/g,
      )) {
        const candidate = trimReferencePunctuation(match[0]);
        if (!candidate || /[*{}<>]/.test(candidate)) continue;
        const absolute = resolveRepositoryPath(candidate);
        if (!fs.existsSync(absolute)) {
          failures.push(relative + ":" + lineNumber + " -> missing referenced path: " + candidate);
        }
      }
    }
  }

  function recordMissingPnpmCommands(line, relative, lineNumber) {
    if (/\bpnpm\s+--dir\b/.test(line)) return;
    for (const match of line.matchAll(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9][A-Za-z0-9:_-]*)/g)) {
      const command = match[1];
      if (pnpmBuiltins.has(command) || scripts.has(command)) continue;
      failures.push(
        relative + ":" + lineNumber +
          " -> command not present in current repository: pnpm " + command,
      );
    }
  }

  for (const file of documentationFiles) {
    const relative = displayPath(file);
    const body = fs.readFileSync(file, "utf8");
    const lines = body.split("\n");

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      recordForbiddenLegacy(line, relative, lineNumber);
      recordMissingRepositoryPaths(line, relative, lineNumber);
      recordMissingPnpmCommands(line, relative, lineNumber);
    }
  }

  if (failures.length > 0) {
    console.error("DOC_REPOSITORY_COMMAND_PARITY=FAIL");
    for (const failure of [...new Set(failures)].toSorted(compareStrings)) {
      console.error("  " + failure);
    }
    process.exit(1);
  }

  console.log("DOC_REPOSITORY_COMMAND_PARITY=PASS");
  console.log("DOC_REPOSITORY_COMMAND_DRIFT_COUNT=0");
}

{
  const root = path.resolve(import.meta.dirname, "../..");
  const knowledgeRoot = ensureKnowledgeRoot({ materialize: false });
  const failures = [];
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const readKnowledge = (p) => fs.readFileSync(path.join(knowledgeRoot, p), "utf8");

  const packageJson = JSON.parse(read("package.json"));
  const developmentGuide = readKnowledge("docs/DEVELOPMENT.md");
  const operationsGuide = readKnowledge("docs/OPERATIONS.md");

  const nodeVersion = read(".nvmrc").trim();
  const nodeVersionFile = read(".node-version").trim();
  const pnpmVersion = /^pnpm@(.+)$/.exec(packageJson.packageManager ?? "")?.[1];
  const goVersion = /^go\s+(\S+)\s*$/m.exec(read("go.work"))?.[1];

  if (!nodeVersion || nodeVersion !== nodeVersionFile) failures.push("Node pin mismatch between .nvmrc and .node-version");
  if (!pnpmVersion || pnpmVersion !== packageJson.engines?.pnpm) failures.push("pnpm pin mismatch between packageManager and engines.pnpm");
  if (!packageJson.engines?.node?.includes(nodeVersion)) failures.push("engines.node does not admit pinned Node " + nodeVersion);
  if (!goVersion) failures.push("go.work missing Go version");

  function findGoMods(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === ".git" || entry.name === ".kilo" || entry.name === ".cache") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findGoMods(full));
      } else if (entry.name === "go.mod") {
        results.push(full);
      }
    }
    return results;
  }

  const allGoMods = findGoMods(root).map((f) => path.relative(root, f).replaceAll("\\", "/"));
  for (const mod of allGoMods) {
    const version = /^go\s+(\S+)\s*$/m.exec(read(mod))?.[1];
    if (version !== goVersion) failures.push(mod + " Go version differs from go.work");
  }

  function requireMetadata(body, key, expected, owner) {
    const pattern = new RegExp(String.raw`^${key}:\s*(\S+)\s*$`, "m");
    const match = pattern.exec(body);
    if (!match || match[1] !== expected) failures.push(`${owner} must declare ${key}: ${expected}`);
  }

  requireMetadata(developmentGuide, "DOCUMENT_CLASS", "NONAUTHORITATIVE_DEVELOPMENT_GUIDE", "docs/DEVELOPMENT.md");
  requireMetadata(developmentGuide, "CURRENT_IMPLEMENTATION_AUTHORITY", "NONE", "docs/DEVELOPMENT.md");
  requireMetadata(operationsGuide, "DOCUMENT_CLASS", "NONAUTHORITATIVE_OPERATIONS_GUIDE", "docs/OPERATIONS.md");
  requireMetadata(operationsGuide, "CURRENT_IMPLEMENTATION_AUTHORITY", "NONE", "docs/OPERATIONS.md");

  if (!/current repository commands, paths, versions and runtime shape are sourced from the consuming repository/i.test(developmentGuide)) {
    failures.push("development guide must route mutable command/path/version/runtime truth to the consuming repository");
  }
  if (!/operational actions are source-derived from the exact implementation candidate/i.test(operationsGuide)) {
    failures.push("operations guide must route operational truth to the exact implementation candidate");
  }
  if (!/does not freeze commands, ports, container names, credentials or provider settings/i.test(operationsGuide)) {
    failures.push("operations guide must explicitly reject frozen mutable runtime configuration");
  }

  const guides = [
    ["docs/DEVELOPMENT.md", developmentGuide],
    ["docs/OPERATIONS.md", operationsGuide],
  ];
  for (const [name, body] of guides) {
    if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(body)) failures.push(name + " hard-codes a local port");
    if (/\b(?:node|pnpm|go)\s+v?\d+\.\d+(?:\.\d+)?\b/i.test(body)) failures.push(name + " freezes a mutable toolchain version");
    if (/\b(?:runtime:integration|runtime:daily):/i.test(body)) failures.push(name + " freezes a retired parallel runtime command family");
  }

  if (/docker compose/i.test(read("tools/dev/bootstrap.ps1"))) failures.push("bootstrap must remain independent of runtime composition");

  if (failures.length) {
    console.error("DOC_CONFIG_PARITY=FAIL");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  console.log("DOC_CONFIG_PARITY=PASS");
  console.log("DOC_MUTABLE_CONFIGURATION_AUTHORITY=CONSUMING_REPOSITORY");
  console.log("NODE=" + nodeVersion);
  console.log("PNPM=" + pnpmVersion);
  console.log("GO=" + goVersion);

}
