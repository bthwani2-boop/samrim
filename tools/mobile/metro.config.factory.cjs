const { spawnSync } = require("node:child_process");

const WATCHMAN_REQUIRED_CAPABILITIES = [
  "field-content.sha1hex",
  "relative_root",
  "suffix-set",
  "wildmatch",
];

function runWatchman(args) {
  return spawnSync("watchman", args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function formatWatchmanFailure(result) {
  return result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
}

function assertWindowsWatchmanAvailable(projectRoot) {
  if (process.platform !== "win32") return;

  const capabilitiesResult = runWatchman([
    "list-capabilities",
    "--output-encoding=json",
    "--no-pretty",
    "--no-spawn",
  ]);
  if (capabilitiesResult.error || capabilitiesResult.status !== 0) {
    throw new Error(
      "Samrim mobile runtime requires a healthy Watchman installation on Windows. " +
        "Metro startup is blocked rather than falling back to the high-handle Node watcher. " +
        `(${formatWatchmanFailure(capabilitiesResult)})`,
    );
  }

  let capabilitiesPayload;
  try {
    capabilitiesPayload = JSON.parse(capabilitiesResult.stdout || "{}");
  } catch (error) {
    throw new Error(
      "Samrim mobile runtime could not parse Watchman capability output. " +
        `(${error.message})`,
    );
  }

  const available = new Set(
    Array.isArray(capabilitiesPayload.capabilities) ? capabilitiesPayload.capabilities : [],
  );
  const missing = WATCHMAN_REQUIRED_CAPABILITIES.filter((capability) => !available.has(capability));
  if (typeof capabilitiesPayload.version !== "string" || missing.length > 0) {
    throw new Error(
      "Samrim mobile runtime rejected the installed Watchman. " +
        (missing.length > 0 ? `Missing: ${missing.join(", ")}` : "No valid Watchman version reported."),
    );
  }

  const watchProject = runWatchman(["watch-project", projectRoot]);
  if (watchProject.error || watchProject.status !== 0) {
    throw new Error(
      "Samrim mobile runtime could not establish a Watchman project watch. " +
        `(${formatWatchmanFailure(watchProject)})`,
    );
  }
}

function createSamrimMetroConfig(projectRoot) {
  let config;
  try {
    const sentryPath = require.resolve("@sentry/react-native/metro", { paths: [projectRoot] });
    const { getSentryExpoConfig } = require(sentryPath);
    config = getSentryExpoConfig(projectRoot);
  } catch {
    const { getDefaultConfig } = require(
      require.resolve("expo/metro-config", { paths: [projectRoot] }),
    );
    config = getDefaultConfig(projectRoot);
  }

  if (process.platform === "win32") {
    assertWindowsWatchmanAvailable(projectRoot);
    config.resolver ??= {};
    config.resolver.useWatchman = true;
  }

  return config;
}

module.exports = { createSamrimMetroConfig };
