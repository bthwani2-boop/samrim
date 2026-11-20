// Enforce the existing service-source placement law, including newly authored files.
// This is a structural guard; it does not validate runtime API/SQL behavior.
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const owners = ['identity', 'dsh', 'wlt'];
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const goPackageName = /^[a-z][a-z0-9]*$/;
const migrationName = /^\d{3}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.sql$/;

function walk(folder, visit, issues, base) {
  if (!existsSync(folder)) return;
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
  for (const owner of owners) {
    const dir = join(base, 'services', owner);
    if (!existsSync(dir)) continue;
    walk(dir, (path, isDirectory) => {
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
      if (extname(path) === '.sql' && !(parts.length === 3 && parts[0] === 'database' &&
          parts[1] === 'migrations' && migrationName.test(parts[2]))) {
        issues.push(path + ': SQL belongs in numbered descriptive owner migrations/');
      }
    }, issues, base);
  }
  return issues;
}
