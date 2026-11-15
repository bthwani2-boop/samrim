const { getDefaultConfig } = require("expo/metro-config");
// Expo 58 monorepo discovery is authoritative; no donor watcher or cache override.
module.exports = getDefaultConfig(__dirname);
