/** @type {import("next").NextConfig} */
import fs from "node:fs";
import path from "node:path";

const secretsRoot = process.env.BTHWANI_SECRETS_ROOT || "C:\\BTHWANI-Secrets\\samrim";
const mapsEnvPath = path.join(secretsRoot, "env", "control-panel.google.env");
if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY && fs.existsSync(mapsEnvPath)) {
  for (const rawLine of fs.readFileSync(mapsEnvPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0 && line.slice(0, separator).trim() === "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY") {
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      break;
    }
  }
}

const nextConfig = {
  transpilePackages: ["@bthwani/identity", "@bthwani/design-system"],
  poweredByHeader: false,
  // The development overlay injects inline styles that violate the application CSP.
  devIndicators: false,
  // Keep Next dev from scaffolding agent instruction files inside this app.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
