import fs from "node:fs";
import path from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("Usage: node test-mobile-app.mjs <app-name>");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps", app);

const configPath = path.join(appDir, "mobile.config.json");
if (!fs.existsSync(configPath)) {
  console.error(`${app}: missing mobile.config.json`);
  process.exit(1);
}

const identityPath = path.join(appDir, "src", "identity.ts");
if (!fs.existsSync(identityPath)) {
  console.error(`${app}: missing src/identity.ts`);
  process.exit(1);
}

const identityContent = fs.readFileSync(identityPath, "utf8");
for (const required of ["restoreIdentitySession", "currentIdentityState", "logoutIdentity"]) {
  if (!identityContent.includes(required)) {
    console.error(`${app}: src/identity.ts missing ${required}`);
    process.exit(1);
  }
}

const entryPath = path.join(appDir, "app", "index.tsx");
if (!fs.existsSync(entryPath)) {
  console.error(`${app}: missing app/index.tsx`);
  process.exit(1);
}

console.log(`MOBILE_TEST=PASS app=${app}`);
