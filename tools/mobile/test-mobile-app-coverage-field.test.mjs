// Sonar coverage entry point for the existing Field mobile behavioral harness.
process.argv[2] = "app-field";
await import("./test-mobile-app.mjs");
