#!/usr/bin/env node
// Ephemeral source/consumer inventory. Owner labels are path-derived, not a permissions registry.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { extname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceExt = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".go"]);
const jsExt = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const generatedParts = new Set(["node_modules", ".git", ".next", ".expo", "dist", "build", "coverage", "generated"]);

function listGitPaths(checkout, mode) {
  const cmd = spawnSync("git", ["-C", checkout, "ls-files", "-z", ...mode], {
    encoding: "buffer", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (cmd.status !== 0 || cmd.error) throw new Error("Git source enumeration failed");
  return cmd.stdout.toString("utf8").split("\0").filter(Boolean).map(p => p.replaceAll("\\", "/"));
}

function safeFileInfo(checkout, pathname) {
  let current = checkout;
  for (const segment of pathname.split("/")) {
    if (!segment || segment === "." || segment === "..") return undefined;
    current = join(current, segment);
    let st;
    try { st = lstatSync(current); } catch { return undefined; }
    if (st.isSymbolicLink()) return undefined;
  }
  try { return lstatSync(current); } catch { return undefined; }
}

function owner(pathname) {
  const [area, name] = pathname.split("/");
  if (area === "services" && ["identity", "dsh", "wlt"].includes(name)) return "owner:" + name;
  if (area === "apps" && ["customer", "merchant", "captain", "control-panel"].includes(name)) {
    return "surface:" + name;
  }
  if (area === "packages") return "package:" + name;
  if (area === "governance") return "governance";
  if (area === "infra") return "infrastructure";
  if (area === "tools") return "developer-tooling";
  return "repository";
}

function kind(pathname, ext) {
  const parts = pathname.split("/");
  if (parts.some(part => generatedParts.has(part)) || /\.generated\./.test(pathname)) return "generated";
  if (parts.some(part => ["fixtures", "__tests__"].includes(part)) ||
    /\.(test|spec)\.[mc]?[jt]sx?$/.test(pathname)) return "test-fixture";
  if (parts[0] === "apps" && parts[2] === "app" &&
    /^(?:_?layout|index|page|route|\+html)\.[jt]sx?$/.test(parts.at(-1))) return "route-entry";
  if (parts[0] === "services" && parts.includes("contracts")) return "owner-contract";
  if (parts[0] === "services" && parts[2] === "clients" && sourceExt.has(ext)) return "owner-client";
  if (parts[0] === "services" && parts[2] === "backend" && sourceExt.has(ext)) return "owner-backend";
  if (ext === ".sql") return "migration";
  if (parts[0] === "tools" && sourceExt.has(ext)) return "tooling";
  if (ext === ".md") return "documentation";
  if (sourceExt.has(ext)) return "source";
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"].includes(ext)) return "asset";
  return "other";
}

function imports(pathname, source) {
  const ext = extname(pathname);
  const found = new Set();
  if (ext === ".go") {
    for (const match of source.matchAll(/^\s*import\s+"([^"]+)"/gm)) found.add(match[1]);
    for (const match of source.matchAll(/^\s*import\s*\(([\s\S]*?)^\s*\)/gm)) {
      for (const line of match[1].split(/\r?\n/)) {
        const m = /^\s*(?:(?:[\w.]+)\s+)?"([^"]+)"/.exec(line);
        if (m) found.add(m[1]);
      }
    }
  } else if (sourceExt.has(ext)) {
    // The pinned TypeScript 7 package only supplies the CLI. Statically parse
    // literal imports as a bounded best-effort census, not a complete call graph.
    const cleaned = source.replace(/^\s*\/\/[^\n]*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const patterns = [
      /\b(?:import|export)\s+(?:type\s+)?[^;"']{0,800}?\s+from\s+["']([^"']+)["']/g,
      /\bimport\s+["']([^"']+)["']/g,
      /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of cleaned.matchAll(pattern)) found.add(match[1]);
    }
  }
  return [...found].sort();
}

function exportedPackages(rows, contents) {
  const exports = new Map();
  for (const row of rows) {
    if (!row.path.endsWith("/package.json")) continue;
    let config;
    try { config = JSON.parse(contents.get(row.path)); } catch { continue; }
    if (typeof config.name !== "string" || !config.exports) continue;
    const entries = typeof config.exports === "object" && !Array.isArray(config.exports) &&
      Object.keys(config.exports).some(k => k === "." || k.startsWith("./"))
      ? config.exports : { ".": config.exports };
    for (const [subpath, definition] of Object.entries(entries)) {
      if (subpath.includes("*")) continue; // Wildcards cannot reliably map to one source.
      const candidates = typeof definition === "string" ? [definition] :
        [definition?.types, definition?.default, definition?.import].filter(c => typeof c === "string");
      const specifier = config.name + (subpath === "." ? "" : "/" + subpath.slice(2));
      for (const target of candidates) {
        const targetPath = posix.normalize(posix.join(posix.dirname(row.path), target));
        if (contents.has(targetPath)) {
          exports.set(specifier, targetPath);
          break;
        }
      }
    }
  }
  return exports;
}

function resolveConsumerImport(importer, specifier, available, exported) {
  if (!specifier.startsWith(".")) return exported.get(specifier);
  const target = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (target === ".." || target.startsWith("../") || target.startsWith("/")) return undefined;
  const candidates = [target, ...jsExt.map(ext => target + ext),
    ...jsExt.map(ext => target + "/index" + ext)];
  // Explicit .js specifiers may refer to authored .ts equivalents.
  if (/\.[cm]?js$/.test(target)) {
    const without = target.replace(/\.[cm]?js$/, "");
    candidates.push(...jsExt.map(ext => without + ext));
  }
  return candidates.find(candidate => available.has(candidate));
}

export function inventory(checkout = root) {
  const base = resolve(checkout);
  const tracked = new Set(listGitPaths(base, ["--cached"]));
  const untracked = listGitPaths(base, ["--others", "--exclude-standard"]);
  const rows = [];
  const contents = new Map();
  for (const pathname of new Set([...tracked, ...untracked])) {
    const ext = extname(pathname).toLowerCase();
    const st = safeFileInfo(base, pathname);
    const file = Boolean(st?.isFile());
    let lines = null;
    let modules = [];
    if (file && (sourceExt.has(ext) || ext === ".json")) {
      const text = readFileSync(join(base, pathname), "utf8");
      contents.set(pathname, text);
      if (sourceExt.has(ext)) {
        lines = text.length === 0 ? 0 : text.split(/\r?\n/).length - Number(text.endsWith("\n"));
        modules = imports(pathname, text);
      }
    }
    rows.push({
      path: pathname, owner: owner(pathname), kind: kind(pathname, ext),
      extension: ext, tracked: tracked.has(pathname), state: !st ? "missing-or-linked" :
        file ? "file" : "non-file", bytes: file ? st.size : null,
      lines, imports: modules, importedBy: [],
    });
  }
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const available = new Set(rows.filter(row => row.state === "file").map(row => row.path));
  const exported = exportedPackages(rows, contents);
  const lookup = new Map(rows.map(row => [row.path, row]));
  for (const row of rows) {
    for (const specifier of row.imports) {
      const target = resolveConsumerImport(row.path, specifier, available, exported);
      if (target && target !== row.path) lookup.get(target).importedBy.push(row.path);
    }
  }
  for (const row of rows) row.importedBy = [...new Set(row.importedBy)].sort();
  return rows;
}

export function summary(rows) {
  const tally = items => Object.fromEntries([...new Set(items)].sort().map(key =>
    [key, items.filter(item => item === key).length]));
  return {
    files: rows.length,
    tracked: rows.filter(row => row.tracked).length,
    untracked: rows.filter(row => !row.tracked).length,
    linkedOrMissing: rows.filter(row => row.state !== "file").length,
    owners: tally(rows.map(row => row.owner)),
    kinds: tally(rows.map(row => row.kind)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--summary")) {
    console.error("Usage: node tools/dev/source-inventory.mjs [--summary]");
    process.exitCode = 2;
  } else {
    const rows = inventory();
    if (args.includes("--summary")) console.log(JSON.stringify(summary(rows)));
    else for (const row of rows) console.log(JSON.stringify(row));
  }
}
