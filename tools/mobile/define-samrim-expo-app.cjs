"use strict";

const fs = require("fs");
const path = require("path");
const { resolveGoogleServicesFile } = require("./mobile-provider-env.cjs");

const repositoryRoot = path.resolve(__dirname, "../..");

const PERMISSION_TEXT = {
  photos: "نحتاج الوصول إلى معرض الصور لاختيار الصور ومشاركتها.",
  camera: "نحتاج الوصول إلى الكاميرا لالتقاط الصور الثابتة عند الحاجة.",
  locationWhenInUse: "نحتاج الوصول إلى موقعك عند طلب التقاط موقع العنوان أو أصل المتجر.",
  locationAlwaysAndWhenInUse: "نحتاج الوصول إلى الموقع في الخلفية لتتبع مسار المهمة النشطة.",
};

function optionalEnvironmentValue(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function appEnvSuffix(appKey) {
  return appKey.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function resolveAppEnvironmentValue(baseName, appKey) {
  return (
    optionalEnvironmentValue(process.env[baseName + "_" + appEnvSuffix(appKey)]) ??
    optionalEnvironmentValue(process.env[baseName])
  );
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

function readPackageJson(appKey) {
  return JSON.parse(fs.readFileSync(path.join(appRoot(appKey), "package.json"), "utf8"));
}

function hasRuntimeDependency(packageJson, packageName) {
  return [packageJson.dependencies, packageJson.devDependencies, packageJson.optionalDependencies].some(
    (section) => section && Object.prototype.hasOwnProperty.call(section, packageName),
  );
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

function buildPlugins(appKey, packageJson, { locationMode }) {
  const plugins = [];

  if (hasRuntimeDependency(packageJson, "expo-image-picker")) {
    plugins.push([
      "expo-image-picker",
      {
        photosPermission: PERMISSION_TEXT.photos,
        cameraPermission: PERMISSION_TEXT.camera,
        microphonePermission: false,
      },
    ]);
  }
  if (hasRuntimeDependency(packageJson, "expo-document-picker")) plugins.push("expo-document-picker");

  if (hasRuntimeDependency(packageJson, "react-native-maps")) {
    const androidMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_ANDROID_API_KEY", appKey);
    const iosMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_IOS_API_KEY", appKey);
    const options = {
      ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
      ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
    };
    plugins.push(Object.keys(options).length > 0 ? ["react-native-maps", options] : "react-native-maps");
  }

  if (hasRuntimeDependency(packageJson, "expo-router")) plugins.push("expo-router");
  if (hasRuntimeDependency(packageJson, "expo-updates")) plugins.push("expo-updates");
  if (hasRuntimeDependency(packageJson, "expo-system-ui")) plugins.push("expo-system-ui");

  if (hasRuntimeDependency(packageJson, "expo-splash-screen")) {
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
  }

  if (hasRuntimeDependency(packageJson, "expo-location")) {
    const locationOptions = {
      locationWhenInUsePermission: PERMISSION_TEXT.locationWhenInUse,
    };
    if (locationMode === "background") {
      Object.assign(locationOptions, {
        locationAlwaysAndWhenInUsePermission: PERMISSION_TEXT.locationAlwaysAndWhenInUse,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      });
    }
    plugins.push(["expo-location", locationOptions]);
  }

  if (hasRuntimeDependency(packageJson, "expo-notifications")) {
    const notificationIcon = appAsset(appKey, "notification-icon.png");
    plugins.push([
      "expo-notifications",
      {
        defaultChannel: "bthwani-operational",
        ...(notificationIcon ? { icon: notificationIcon } : {}),
      },
    ]);
  }

  if (hasRuntimeDependency(packageJson, "expo-secure-store")) plugins.push("expo-secure-store");
  if (hasRuntimeDependency(packageJson, "expo-localization")) {
    plugins.push([
      "expo-localization",
      {
        supportedLocales: { ios: ["ar"], android: ["ar"] },
        forcesRTL: true,
        allowDynamicLocaleChangesAndroid: false,
      },
    ]);
  }

  return plugins;
}

function defineSamrimExpoApp(appKey, options = {}) {
  const app = readMobileConfig(appKey);
  const packageJson = readPackageJson(appKey);
  const locationMode = options.locationMode ?? "foreground";
  if (locationMode !== "foreground" && locationMode !== "background") {
    throw new Error("Invalid locationMode for " + appKey + ": " + locationMode);
  }
  const googleServicesFile = resolveGoogleServicesFile(appKey, process.env);
  const adaptiveIcon = appAsset(appKey, "adaptive-icon.png");
  const android = {
    package: app.androidPackage,
    ...(adaptiveIcon ? { adaptiveIcon: { foregroundImage: adaptiveIcon, backgroundColor: "#FFFFFF" } } : {}),
    ...(googleServicesFile ? { googleServicesFile } : {}),
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
    plugins: buildPlugins(appKey, packageJson, { locationMode }),
    ...(hasRuntimeDependency(packageJson, "expo-router") ? { experiments: { typedRoutes: true } } : {}),
    extra: {
      appKey,
      sourceRepo: "samrim",
      eas: { projectId: app.projectId },
    },
  };
}

module.exports = { defineSamrimExpoApp };
