#!/usr/bin/env node
// UTF-8 source guard. Never rewrites source files or persistent data.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const decoder = new TextDecoder("utf-8", { fatal: true });
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json",
  ".jsonc", ".md", ".mdx", ".go", ".sql", ".yaml", ".yml", ".ps1",
  ".psm1", ".psd1", ".sh", ".bash", ".cmd", ".bat", ".css", ".scss",
  ".html", ".htm", ".txt", ".xml", ".svg", ".csv", ".graphql", ".gql",
  ".properties", ".toml", ".py", ".java", ".kt", ".kts", ".gradle",
  ".swift", ".m", ".mm", ".proto", ".prisma", ".snap", ".ini", ".conf",
]);
const textNames = new Set([
  "Dockerfile", "Makefile", "Jenkinsfile", ".editorconfig", ".gitattributes",
  ".gitignore", ".npmrc", ".nvmrc", ".prettierignore", ".dockerignore",
]);
// Keep alerts specific: a single suspicious Latin-1/Windows-1252 decoding
// pair, or a replacement glyph, is evidence worth reviewing, not auto-fixing.
const continuation = "[\\u0080-\\u00BF\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178\\u20AC]";
const mojibake = new RegExp(
  `(?:[ØÙÃÂÐÑ]${continuation}|[à-ï]${continuation}{2}|[ð-ô]${continuation}{3}|â(?:€|[\\u0080-\\u00BF]))`,
  "gu",
);

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function isTextFile(name) {
  const base = path.basename(name);
  return textExtensions.has(path.extname(base).toLowerCase())
    || textNames.has(base)
    || base.startsWith(".env.") && !base.endsWith(".local");
}

export function inspectEncoding(bytes) {
  const issues = [];
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    issues.push("UTF-8 BOM");
  }
  let source;
  try {
    source = decoder.decode(bytes);
  } catch {
    return ["invalid UTF-8 byte sequence"];
  }
  const replacement = source.indexOf("\uFFFD");
  if (replacement !== -1) {
    issues.push(`replacement character U+FFFD at line ${lineAt(source, replacement)}`);
  }
  const hit = mojibake.exec(source);
  mojibake.lastIndex = 0;
  if (hit) {
    issues.push(`possible mojibake at line ${lineAt(source, hit.index)} (inspect original bytes)`);
  }
  return issues;
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

function main(args) {
  const all = args.includes("--all");
  const baseIndex = args.indexOf("--base");
  if (all && baseIndex !== -1) throw new Error("choose --all or --base, not both");
  if (args.some((arg, i) => !["--all", "--base"].includes(arg) && (baseIndex < 0 || i !== baseIndex + 1))) {
    throw new Error("usage: node tools/dev/check-encoding.mjs [--all | --base <commit>]");
  }
  if (baseIndex !== -1 && !args[baseIndex + 1]) throw new Error("missing --base commit");

  const names = all
    ? git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    : baseIndex !== -1
      ? git(["diff", "--name-only", "-z", args[baseIndex + 1], "HEAD", "--"])
      : [...git(["diff", "--name-only", "-z", "HEAD", "--"]),
         ...git(["ls-files", "--others", "--exclude-standard", "-z"])];
  let checked = 0;
  const failures = [];
  for (const name of new Set(names)) {
    if (!isTextFile(name)) continue;
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep)) continue;
    let stat;
    try { stat = fs.lstatSync(file); } catch (err) {
      if (err.code === "ENOENT") continue; // deleted file
      throw err;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    checked++;
    for (const issue of inspectEncoding(fs.readFileSync(file))) {
      failures.push(`${name}: ${issue}`);
    }
  }
  if (failures.length) {
    for (const item of failures) console.error(`ENCODING_FAIL ${item}`);
    console.error("Review the originating bytes/encoding; do not bulk-replace text.");
    process.exitCode = 1;
  } else {
    console.log(`ENCODING_CHECK=PASS scope=${all ? "all" : baseIndex !== -1 ? "candidate" : "changed"} files=${checked}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (err) { console.error(`ENCODING_CHECK=ERROR ${err.message}`); process.exitCode = 1; }
}
