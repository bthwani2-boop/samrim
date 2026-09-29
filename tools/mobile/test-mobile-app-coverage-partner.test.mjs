// Sonar coverage entry point for the existing Partner mobile behavioral harness.
process.argv[2] = "app-partner";
await import("./test-mobile-app.mjs");
