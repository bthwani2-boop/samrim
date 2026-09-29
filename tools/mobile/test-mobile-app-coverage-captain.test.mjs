// Sonar coverage entry point for the existing Captain mobile behavioral harness.
process.argv[2] = "app-captain";
await import("./test-mobile-app.mjs");
