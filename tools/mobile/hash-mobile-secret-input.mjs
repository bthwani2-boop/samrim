import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.env.BTHWANI_SECRETS_ROOT || "C:\\BTHWANI-Secrets\\samrim";
const file = path.join(root, "env", "mobile.env");

if (!fs.existsSync(file)) {
  console.log("mobile-secret-input:none");
  process.exit(0);
}

const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
console.log("mobile-secret-input:" + digest);
