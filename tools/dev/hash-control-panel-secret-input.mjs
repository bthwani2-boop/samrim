import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.env.BTHWANI_SECRETS_ROOT || "C:\\BTHWANI-Secrets\\samrim";
const file = path.join(root, "env", "control-panel.google.env");

if (!fs.existsSync(file)) {
  console.log("control-panel-secret-input:none");
  process.exit(0);
}

const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
console.log("control-panel-secret-input:" + digest);
