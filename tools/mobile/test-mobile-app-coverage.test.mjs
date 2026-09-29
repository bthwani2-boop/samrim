// Sonar coverage entry point for the existing mobile behavioral harness.
// Keep this wrapper intentionally thin: production behavior remains owned by
// test-mobile-app.mjs and its imported canonical clients.
process.argv[2] = "app-client";
await import("./test-mobile-app.mjs");
