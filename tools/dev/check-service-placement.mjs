// Enforce the existing service-source placement law, including newly authored files.
// This is a structural guard; it does not validate runtime API/SQL behavior.
import { lstatSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const owners = ['identity', 'dsh', 'wlt'];
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const goPackageName = /^[a-z][a-z0-9]*$/;
const baselineName = /^\d{2}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.sql$/;

function walk(folder, visit, issues, base) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(folder, entry.name);
    const path = relative(base, full).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      issues.push(path + ': service source symlink is not an authorized owner path');
    } else if (entry.isDirectory()) {
      visit(path, true);
      walk(full, visit, issues, base);
    } else if (entry.isFile()) {
      visit(path, false);
    }
  }
}

export function serviceSourcePlacementIssues(base) {
  const issues = [];
  const servicesRoot = join(base, 'services');
  const rootInfo = lstatSync(servicesRoot, { throwIfNoEntry: false });
  if (!rootInfo) return issues;
  if (!rootInfo.isDirectory()) return ['services: service source root must be an actual directory'];
  const localOwners = [];
  for (const entry of readdirSync(servicesRoot, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    if (entry.isDirectory() && owners.includes(entry.name)) {
      localOwners.push(entry.name);
    } else if (entry.isFile()) {
      issues.push('services/' + entry.name + ': unowned service root file');
    } else {
      issues.push('services/' + entry.name + ': unapproved service owner or source link');
    }
  }
  for (const owner of localOwners) {
    walk(join(servicesRoot, owner), (path, isDirectory) => {
      const prefix = 'services/' + owner + '/';
      const relativePath = path.slice(prefix.length);
      const parts = relativePath.split('/');
      if (isDirectory) {
        if (parts[0] === 'backend' && parts[1] === 'internal' && parts.length >= 3 &&
            (!goPackageName.test(parts[2]) || ['misc', 'legacy', 'partners'].includes(parts[2]))) {
          issues.push(path + ': Go internal package must be a named owner domain');
        }
        if (parts[0] === 'contracts' && parts[1] === 'openapi' && parts[2] === 'path') {
          issues.push(path + ': OpenAPI fragments belong in paths/, not path/');
        }
        return;
      }
      if (/\.ya?ml$/.test(path)) {
        const ownerEntrypoint = parts.length === 3 && parts[0] === 'contracts' &&
          parts[1] === 'openapi' && parts[2] === owner + '.openapi.yaml';
        const flatPathModule = parts.length === 4 && parts[0] === 'contracts' &&
          parts[1] === 'openapi' && parts[2] === 'paths' &&
          /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/.test(parts[3]);
        // The deprecated path/ folder is already rejected at directory level.
        const bannedLegacyTree = parts[0] === 'contracts' && parts[1] === 'openapi' &&
          parts[2] === 'path';
        if (!ownerEntrypoint && !flatPathModule && !bannedLegacyTree) {
          issues.push(path + ': owner OpenAPI YAML belongs to its entrypoint or flat paths/ modules');
        }
      }
      if (extname(path) === '.go') {
        const inCommand = parts.length === 4 && parts[0] === 'backend' &&
          parts[1] === 'cmd' && parts[2] === owner;
        const inDomain = parts.length >= 4 && parts[0] === 'backend' &&
          parts[1] === 'internal' &&
          parts.slice(2, -1).every(name => goPackageName.test(name) &&
            !['misc', 'legacy', 'partners'].includes(name));
        if (!inCommand && !inDomain) {
          issues.push(path + ': Go source belongs in backend/cmd/' + owner +
            '/ or backend/internal/<domain>/');
        }
      }
      // SQL-01: no new retained-data epoch is approved in the current local
      // experimental phase. Update this guard with that explicit decision,
      // not merely because a development container has an outdated schema.
      if (parts[0] === 'database' && parts[1] === 'migrations') {
        issues.push(path + ': BASELINE_FIRST: edit owner database/schema/; retained migrations require a separately approved epoch');
        return;
      }
      if (extname(path) === '.sql') {
        const validSqlPath = parts.length === 3 && parts[0] === 'database' && (
          (parts[1] === 'schema' && baselineName.test(parts[2])) ||
          (owner === 'wlt' && parts[1] === 'sandbox' && baselineName.test(parts[2]))
        );
        if (!validSqlPath) {
          issues.push(path + ': SQL belongs in numbered owner schema/ or WLT sandbox/');
        }
      }
    }, issues, base);
  }
  return issues;
}
