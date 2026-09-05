/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: ["@bthwani/identity", "@bthwani/design-system"],
  // Keep Next dev from scaffolding agent instruction files inside this app.
  agentRules: false,
};

export default nextConfig;
