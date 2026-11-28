#!/usr/bin/env node
// First-use isolated infrastructure credentials; never read or replace an existing .env.
import { randomBytes } from "node:crypto";
import { closeSync, fstatSync, linkSync, lstatSync, mkdtempSync, openSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readVerifiedFile, samePath } from "../security/verify-secrets.mjs";

const infra = fileURLToPath(new URL("../../infra/", import.meta.url));
const names = ["REF_POSTGRES_USER", "REF_POSTGRES_DB", "REF_MEDIA_BUCKET"];
const secrets = ["REF_POSTGRES_PASSWORD", "REF_MEDIA_ACCESS_KEY", "REF_MEDIA_SECRET_KEY"];

function directoryIdentity(path) {
  const entry = lstatSync(path, { bigint: true });
  if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(realpathSync(path), resolve(path))) {
    throw new Error("Unsafe infrastructure directory");
  }
  return entry;
}

function assertIdentity(actual, expected) {
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error("Infrastructure path identity changed");
  }
}

function existingFile(dest) {
  const entry = lstatSync(dest, { throwIfNoEntry: false });
  if (!entry) return false;
  if (!entry.isFile() || entry.isSymbolicLink() || !samePath(realpathSync(dest), resolve(dest))) {
    throw new Error("infra/.env is not a regular file");
  }
  // No-write result, not admission of existing contents. Concurrent atomic
  // publication briefly gives the inode two names.
  return true;
}

function baseConfiguration(template) {
  const { bytes } = readVerifiedFile(template, 64 * 1024);
  const values = new Map();
  for (const sourceLine of new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || values.has(match[1])) throw new Error("Invalid or duplicate infrastructure template entry");
    values.set(match[1], match[2]);
  }
  for (const key of names) {
    if (!/^[A-Za-z0-9_-]+$/.test(values.get(key) ?? "")) throw new Error(`Invalid template value for ${key}`);
  }
  for (const key of secrets) {
    if (values.get(key) !== "") throw new Error(`Template secret slot must be present and empty: ${key}`);
  }
  return [
    "# Randomized local-only refoundation secrets. NEVER commit or reuse old credentials.",
    ...names.map(key => `${key}=${values.get(key)}`),
    ...secrets.map(key => `${key}=${randomBytes(32).toString("hex")}`),
    "",
  ].join("\n");
}

function assertCandidate(path, expected) {
  const entry = lstatSync(path, { bigint: true });
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Unsafe infrastructure candidate");
  assertIdentity(entry, expected);
  return entry;
}

function assertPublished(path, expected) {
  const actual = assertCandidate(path, expected);
  if (actual.size !== expected.size || actual.mtimeNs !== expected.mtimeNs) {
    throw new Error("Published infrastructure candidate changed");
  }
}

export function initializeEnvironment(infrastructure) {
  const directory = resolve(infrastructure);
  const owner = directoryIdentity(directory);
  const dest = join(directory, ".env");
  if (existingFile(dest)) return "REFOUNDATION_ENV_EXISTS_UNTOUCHED";
  const content = Buffer.from(baseConfiguration(join(directory, ".env.example")), "utf8");
  assertIdentity(directoryIdentity(directory), owner);
  const scratch = mkdtempSync(join(directory, ".env.prepare-"));
  const scratchOwner = directoryIdentity(scratch);
  const candidate = join(scratch, ".env");
  let fileIdentity, published, result, failure;
  const assertDirectories = () => {
    assertIdentity(directoryIdentity(directory), owner);
    assertIdentity(directoryIdentity(scratch), scratchOwner);
  };
  try {
    assertDirectories();
    const fd = openSync(candidate, "wx", 0o600);
    try {
      fileIdentity = fstatSync(fd, { bigint: true });
      writeFileSync(fd, content, { flush: true });
    } finally {
      closeSync(fd);
    }
    assertDirectories();
    // Verify the exact bytes written by this invocation, not an existing secret file.
    const verified = readVerifiedFile(candidate, 64 * 1024);
    assertIdentity(verified.stat, fileIdentity);
    if (!verified.bytes.equals(content)) throw new Error("Infrastructure candidate content changed");
    try {
      // Native atomic no-replace publication on the same filesystem.
      linkSync(candidate, dest);
      assertPublished(dest, verified.stat);
      published = verified.stat;
      result = "REFOUNDATION_ENV_CREATED_LOCAL_ONLY";
    } catch (error) {
      if (error?.code !== "EEXIST" || !existingFile(dest)) throw error;
      result = "REFOUNDATION_ENV_EXISTS_UNTOUCHED";
    }
  } catch (error) {
    failure = error;
  }
  try {
    // Never recursively remove a name that might have been redirected.
    assertDirectories();
    if (fileIdentity) {
      assertCandidate(candidate, fileIdentity);
      unlinkSync(candidate);
    }
    rmdirSync(scratch);
    if (published) assertPublished(dest, published);
  } catch (error) {
    throw failure ? new AggregateError([failure, error], "Environment publication and cleanup failed") : error;
  }
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  console.log(initializeEnvironment(infra));
}
