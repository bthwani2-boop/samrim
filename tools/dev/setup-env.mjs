#!/usr/bin/env node
// First-use isolated infrastructure credentials; never read or replace a live .env.
import { randomBytes } from "node:crypto";
import {
  linkSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dest = fileURLToPath(new URL("../../infra/.env", import.meta.url));
const template = fileURLToPath(new URL("../../infra/.env.example", import.meta.url));
const names = ["REF_POSTGRES_USER", "REF_POSTGRES_DB", "REF_MEDIA_BUCKET"];
const ports = [
  "REF_MAILPIT_PORT", "REF_MEDIA_PORT", "REF_PAYMENT_MOCK_PORT",
  "REF_IDENTITY_VERIFIER_PORT", "REF_DSH_PORT", "REF_WLT_PORT",
];
const secrets = ["REF_POSTGRES_PASSWORD", "REF_MEDIA_ACCESS_KEY", "REF_MEDIA_SECRET_KEY"];

function existingFile() {
  const stat = lstatSync(dest, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isFile()) throw new Error("infra/.env is not a regular file");
  return true;
}

function baseConfiguration() {
  const values = new Map();
  for (const sourceLine of readFileSync(template, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || values.has(match[1])) throw new Error("Invalid or duplicate infrastructure template entry");
    values.set(match[1], match[2]);
  }
  for (const key of names) {
    if (!/^[A-Za-z0-9_-]+$/.test(values.get(key) ?? "")) throw new Error(`Invalid template value for ${key}`);
  }
  for (const key of ports) {
    const value = values.get(key) ?? "";
    if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535) {
      throw new Error(`Invalid template port for ${key}`);
    }
  }
  if (new Set(ports.map(key => values.get(key))).size !== ports.length) {
    throw new Error("Duplicate infrastructure port");
  }
  for (const key of secrets) {
    if (values.get(key) !== "") throw new Error(`Template secret slot must be present and empty: ${key}`);
  }
  return [
    "# Randomized local-only refoundation secrets. NEVER commit or reuse old credentials.",
    ...[...names, ...ports].map(key => `${key}=${values.get(key)}`),
    ...secrets.map(key => `${key}=${randomBytes(32).toString("hex")}`),
    "",
  ].join("\n");
}

function createOnce() {
  if (existingFile()) return false;
  const content = baseConfiguration();
  // Publish a fully written file with a native, atomic no-replace hard link.
  // The private, ignored scratch directory is on the same filesystem.
  const scratch = mkdtempSync(join(dirname(dest), ".env.prepare-"));
  try {
    const candidate = join(scratch, ".env");
    writeFileSync(candidate, content, {
      flag: "wx", encoding: "utf8", mode: 0o600, flush: true,
    });
    try {
      linkSync(candidate, dest);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST" || !existingFile()) throw error;
      return false;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(createOnce() ? "REFOUNDATION_ENV_CREATED_LOCAL_ONLY" : "REFOUNDATION_ENV_EXISTS_UNTOUCHED");
