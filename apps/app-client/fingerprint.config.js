/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  ignorePaths: [
    // pnpm stores packages with platform/version suffixes in paths
    // which differ between local and EAS build environments
    "../../node_modules/.pnpm",
    "node_modules/.pnpm",
    // Generated native directories - not part of the source fingerprint
    "android",
    "ios",
    // Temporary build artifacts
    "../../.tmp",
    ".tmp",
    ".expo",
  ],
};
