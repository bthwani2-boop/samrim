"use strict";

const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");

const PERMISSION_TEXT = {
  locationWhenInUse: "نحتاج الوصول إلى موقعك عند طلب التقاط موقع العنوان أو أصل المتجر.",
};

function appRoot(appKey) {
  return path.resolve(__dirname, "../..", "apps", appKey);
}

function readMobileConfig(appKey) {
  const configPath = path.join(appRoot(appKey), "mobile.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing app-owned mobile config: " + configPath);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function appAsset(appKey, fileName) {
  const absolute = path.join(appRoot(appKey), "assets", fileName);
  return fs.existsSync(absolute) ? "./assets/" + fileName : undefined;
}

function readDesignSystemSurfaceColors() {
  const cssPath = path.join(repositoryRoot, "packages", "design-system", "theme.css");
  const source = fs.readFileSync(cssPath, "utf8");
  const lightBlock = source.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1];
  const darkBlock = source.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)^\s*\}\s*\}/m)?.[1];

  function readSurface(block, mode) {
    const value = block?.match(/^\s*--surface-warm:\s*([^;]+);$/m)?.[1]?.trim();
    if (!value) throw new Error("Missing --surface-warm in " + mode + " design-system theme projection");
    return value;
  }

  return { light: readSurface(lightBlock, "light"), dark: readSurface(darkBlock, "dark") };
}

const designSystemSurfaceColors = readDesignSystemSurfaceColors();

function buildPlugins(appKey, { locationMode }) {
  const plugins = ["expo-router", "expo-updates", "expo-system-ui"];

  const splashIcon = appAsset(appKey, "splash-icon.png");
  plugins.push(
    splashIcon
      ? [
          "expo-splash-screen",
          {
            image: splashIcon,
            imageWidth: 220,
            resizeMode: "contain",
            backgroundColor: designSystemSurfaceColors.light,
            dark: { image: splashIcon, backgroundColor: designSystemSurfaceColors.dark },
          },
        ]
      : "expo-splash-screen",
  );

  if (locationMode === "foreground") {
    const locationOptions = {
      locationWhenInUsePermission: PERMISSION_TEXT.locationWhenInUse,
    };
    plugins.push(["expo-location", locationOptions]);
  }

  plugins.push("expo-secure-store");
  plugins.push([
    "expo-localization",
    {
      supportedLocales: { ios: ["ar"], android: ["ar"] },
      forcesRTL: true,
      allowDynamicLocaleChangesAndroid: false,
    },
  ]);

  return plugins;
}

function defineSamrimExpoApp(appKey, options = {}) {
  const app = readMobileConfig(appKey);
  const locationMode = options.locationMode;
  if (locationMode !== undefined && locationMode !== "foreground") {
    throw new Error("Invalid locationMode for " + appKey + ": " + locationMode);
  }
  const adaptiveIcon = appAsset(appKey, "adaptive-icon.png");
  const android = {
    package: app.androidPackage,
    ...(adaptiveIcon ? { adaptiveIcon: { foregroundImage: adaptiveIcon, backgroundColor: "#FFFFFF" } } : {}),
  };

  return {
    name: app.name,
    slug: app.slug,
    entryPoint: "./index.js",
    owner: app.owner,
    platforms: ["ios", "android"],
    scheme: app.scheme,
    version: app.version,
    icon: appAsset(appKey, "icon.png"),
    runtimeVersion: { policy: "appVersion" },
    updates: {
      url: "https://u.expo.dev/" + app.projectId,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    android,
    ios: { bundleIdentifier: app.iosBundleIdentifier, supportsTablet: false },
    plugins: buildPlugins(appKey, { locationMode }),
    experiments: { typedRoutes: true },
    extra: {
      appKey,
      sourceRepo: "samrim",
      eas: { projectId: app.projectId },
    },
  };
}

module.exports = { defineSamrimExpoApp };
