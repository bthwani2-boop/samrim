function createSamrimMetroConfig(projectRoot) {
  try {
    const sentryPath = require.resolve("@sentry/react-native/metro", { paths: [projectRoot] });
    const { getSentryExpoConfig } = require(sentryPath);
    return getSentryExpoConfig(projectRoot);
  } catch {
    const { getDefaultConfig } = require(
      require.resolve("expo/metro-config", { paths: [projectRoot] }),
    );
    return getDefaultConfig(projectRoot);
  }
}

module.exports = { createSamrimMetroConfig };
