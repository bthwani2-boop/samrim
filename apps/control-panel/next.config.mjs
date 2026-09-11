/** @type {import("next").NextConfig} */
const isProduction = process.env.NODE_ENV === "production";

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@bthwani/identity", "@bthwani/design-system"],
  poweredByHeader: false,
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
          ...(isProduction
            ? [{
                key: "Strict-Transport-Security",
                value: "max-age=63072000; includeSubDomains; preload",
              }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
