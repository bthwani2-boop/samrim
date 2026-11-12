#!/usr/bin/env node
// Static RTL ownership guard for the Expo presentation surfaces.
// This supplements, but never replaces, real browser and native navigation tests.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const surfaces = ["customer", "merchant", "captain"];
const sourceExtensions = new Set([".tsx", ".ts", ".jsx", ".js"]);

export function sourceViolations(source, filename) {
  const path = filename.replaceAll("\\", "/");
  // This is the Expo Web document boundary, not a screen-local override.
  if (path.endsWith("/app/+html.tsx")) return [];
  const rules = [
    ["Expo Router manual LocaleProvider", /\bLocaleProvider\b/g],
    ["runtime native RTL override", /\bI18nManager\s*\.\s*(?:forceRTL|allowRTL|swapLeftAndRightInRTL)\s*\(/g],
    ["physical text alignment", /\btextAlign\s*(?::|=)\s*\{?\s*["'](?:left|right)["']/g],
    ["screen direction override", /\b(?:direction|writingDirection)\s*(?::|=)\s*\{?\s*["'](?:rtl|ltr)["']/g],
    ["screen HTML direction override", /\bdir\s*=\s*\{?\s*["'](?:rtl|ltr)["']/g],
    ["manual reverse of row for locale", /\bflexDirection\s*(?::|=)\s*\{?\s*["']row-reverse["']/g],
  ];
  const issues = [];
  for (const [label, expression] of rules) {
    for (const match of source.matchAll(expression)) {
      const line = source.slice(0, match.index).split("\n").length;
      issues.push(path + ":" + line + " " + label);
    }
  }
  return issues;
}

export function nativeConfigViolations(source) {
  const problems = [];
  if ((source.match(/["']expo-localization["']/g) ?? []).length !== 1) {
    problems.push("tools/mobile/define-bthwani-expo-app.cjs must configure expo-localization exactly once");
  }
  if (!/\bforcesRTL\s*:\s*true\b/.test(source)) {
    problems.push("Native RTL must be forced by the canonical expo-localization plugin");
  }
  if (!/supportedLocales\s*:\s*\{\s*ios\s*:\s*\[\s*["']ar["']\s*\]\s*,\s*android\s*:\s*\[\s*["']ar["']\s*\]/.test(source)) {
    problems.push("Native locale support must include Arabic for iOS and Android");
  }
  if (/\bsupportsRTL\s*:\s*false\b/.test(source)) {
    problems.push("Native RTL support must not be disabled");
  }
  return problems;
}

function sourceFiles(root, directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".expo", ".next", "dist", "build", "__tests__"].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(root, absolute));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name)) &&
      !/\.(?:test|spec)\.[jt]sx?$/.test(entry.name)) {
      files.push([relative(root, absolute).replaceAll("\\", "/"), readFileSync(absolute, "utf8")]);
    }
  }
  return files;
}

export function verifyRtl(root = repoRoot) {
  const issues = [];
  let filesChecked = 0;
  for (const app of surfaces) {
    for (const directory of ["app", "src"]) {
      const path = join(root, "apps", app, directory);
      // src/ is intentionally absent from the Stage-4 empty shells.
      if (directory === "src") {
        try {
          const files = sourceFiles(root, path);
          for (const [name, body] of files) { filesChecked++; issues.push(...sourceViolations(body, name)); }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      } else {
        for (const [name, body] of sourceFiles(root, path)) {
          filesChecked++;
          issues.push(...sourceViolations(body, name));
        }
      }
    }
  }
  issues.push(...nativeConfigViolations(readFileSync(
    join(root, "tools", "mobile", "define-bthwani-expo-app.cjs"), "utf8"
  )));
  return { filesChecked, issues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { filesChecked, issues } = verifyRtl();
  if (issues.length) {
    console.error("EXPO_RTL_SOURCE_GUARD=FAIL");
    for (const issue of issues) console.error(" - " + issue);
    process.exitCode = 1;
  } else {
    console.log("EXPO_RTL_SOURCE_GUARD=PASS files=" + filesChecked + " native_runtime=NOT_RUN");
  }
}
