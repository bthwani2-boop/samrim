"use strict";

const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");

const PERMISSION_TEXT = {
  locationWhenInUse: "نحتاج الوصول إلى موقعك عند طلب التقاط موقع العنوان أو أصل المتجر.",
};

const MAP_KEY_NAMES = {
  "app-client": { android: "GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT", ios: "GOOGLE_MAPS_IOS_API_KEY" },
  "app-captain": { android: "GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN", ios: "GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN" },
  "app-field": { android: "GOOGLE_MAPS_ANDROID_API_KEY_APP_FIELD", ios: "GOOGLE_MAPS_IOS_API_KEY" },
  "app-partner": { android: "GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER", ios: "GOOGLE_MAPS_IOS_API_KEY" },
};

function mobileSecretEnvValue(name) {
  const explicit = process.env[name]?.trim();
  if (explicit) return explicit;

  const secretsRoot = process.env.BTHWANI_SECRETS_ROOT || "C:\\BTHWANI-Secrets\\samrim";
  const envPath = path.join(secretsRoot, "env", "mobile.env");
  if (!fs.existsSync(envPath)) return "";

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0 || line.slice(0, separator).trim() !== name) continue;
    return line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

function mobileMapsApiKey(appKey, platform) {
  const envNames = MAP_KEY_NAMES[appKey];
  if (!envNames) return undefined;
  const specificEnvName = envNames[platform];
  const baseEnvName = `GOOGLE_MAPS_${platform.toUpperCase()}_API_KEY`;
  return mobileSecretEnvValue(specificEnvName) || mobileSecretEnvValue(baseEnvName) || undefined;
}

function mobileGoogleServicesFile(appKey, androidPackage) {
  const suffix = appKey.replace(/^app-/, "").replace(/-/g, "_").toUpperCase();
  const envName = `GOOGLE_SERVICES_JSON_APP_${suffix}`;
  const configuredPath = mobileSecretEnvValue(envName);
  const secretsRoot = process.env.BTHWANI_SECRETS_ROOT || "C:\\BTHWANI-Secrets\\samrim";
  const filePath = configuredPath || path.join(secretsRoot, "firebase", appKey, "google-services.json");
  if (!fs.existsSync(filePath)) {
    if (configuredPath) throw new Error("Configured Firebase Android file is missing for " + appKey + ".");
    return undefined;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Configured Firebase Android file is invalid for " + appKey + ".");
  }
  const hasMatchingAndroidClient = Array.isArray(config.client) && config.client.some(
    (client) => client.client_info?.android_client_info?.package_name === androidPackage,
  );
  if (!hasMatchingAndroidClient) {
    throw new Error("Firebase Android file package does not match " + appKey + ".");
  }
  return filePath;
}

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

/**
 * @param {string} appKey
 * @param {{ locationMode?: "foreground", maps?: boolean }} options
 */
function defineSamrimExpoApp(appKey, options = {}) {
  const app = readMobileConfig(appKey);
  for (const name of ["EXPO_PUBLIC_IDENTITY_API_URL", "EXPO_PUBLIC_DSH_API_URL"]) {
    if (!process.env[name]?.trim()) {
      throw new Error("Missing required mobile service endpoint " + name + " for " + appKey + ".");
    }
  }
  const locationMode = options.locationMode;
  if (locationMode !== undefined && locationMode !== "foreground") {
    throw new Error("Invalid locationMode for " + appKey + ": " + locationMode);
  }
  const adaptiveIcon = appAsset(appKey, "adaptive-icon.png");
  const googleServicesFile = mobileGoogleServicesFile(appKey, app.androidPackage);
  const androidMapsApiKey = options.maps ? mobileMapsApiKey(appKey, "android") : undefined;
  const iosMapsApiKey = options.maps ? mobileMapsApiKey(appKey, "ios") : undefined;
  if (options.maps && (!androidMapsApiKey || !iosMapsApiKey)) {
    throw new Error("Missing Google Maps API keys for " + appKey + " in the mobile secret environment.");
  }
  const android = {
    package: app.androidPackage,
    ...(googleServicesFile ? { googleServicesFile } : {}),
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
    plugins: [
      ...buildPlugins(appKey, { locationMode }),
      ...(options.maps ? [["react-native-maps", { androidGoogleMapsApiKey: androidMapsApiKey, iosGoogleMapsApiKey: iosMapsApiKey }]] : []),
    ],
    experiments: { typedRoutes: true },
    extra: {
      appKey,
      sourceRepo: "samrim",
      eas: { projectId: app.projectId },
    },
  };
}

module.exports = { defineSamrimExpoApp };
