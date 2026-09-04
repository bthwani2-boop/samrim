"use strict";

const fs = require("fs");
const path = require("path");
const {
  resolveGoogleServicesFile,
  resolveSentryEnvironment,
} = require("./sentry-env.cjs");

const PERMISSION_TEXT = {
  photos: "نحتاج الوصول إلى معرض الصور لاختيار الصور ومشاركتها.",
  camera: "نحتاج الوصول إلى الكاميرا لالتقاط الصور أو الفيديو عند الحاجة.",
  microphone: "نحتاج الوصول إلى الميكروفون لتسجيل الرسائل الصوتية أو الفيديو المرتبط بالطلب.",
  locationWhenInUse: "نحتاج الوصول إلى موقعك لعرض أقرب الخدمات وتتبع الطلبات.",
  locationAlwaysAndWhenInUse: "نحتاج الوصول إلى الموقع في الخلفية لتتبع مسار المهمة النشطة وتحديد وصول الكابتن.",
  faceId: "نحتاج حماية التطبيق باستخدام البصمة أو Face ID للعمليات الحساسة والمحفظة.",
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
    optionalEnvironmentValue(process.env[`${baseName}_${appEnvSuffix(appKey)}`]) ??
    optionalEnvironmentValue(process.env[baseName])
  );
}

function appRoot(appKey) {
  return path.resolve(__dirname, "../..", "apps", appKey);
}

function readMobileConfig(appKey) {
  const configPath = path.join(appRoot(appKey), "mobile.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing app-owned mobile config: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function readPackageJson(appKey) {
  const packagePath = path.join(appRoot(appKey), "package.json");
  return fs.existsSync(packagePath)
    ? JSON.parse(fs.readFileSync(packagePath, "utf8"))
    : { dependencies: {}, devDependencies: {}, peerDependencies: {}, optionalDependencies: {} };
}

function hasRuntimeDependency(appKey, packageName) {
  const packageJson = readPackageJson(appKey);
  return [packageJson.dependencies, packageJson.devDependencies, packageJson.peerDependencies, packageJson.optionalDependencies]
    .some((section) => section && Object.prototype.hasOwnProperty.call(section, packageName));
}

function appAsset(appKey, fileName) {
  const absolute = path.join(appRoot(appKey), "assets", fileName);
  return fs.existsSync(absolute) ? `./assets/${fileName}` : undefined;
}

function mediaCapabilities(capabilities) {
  const hasImagePicker = capabilities.includes("imagePicker");
  const hasCamera = capabilities.includes("camera");
  const hasAudioRecording = capabilities.includes("audio");
  const hasVideoPlayback = capabilities.includes("video");
  const hasVideoRecording = hasCamera && hasVideoPlayback;
  return {
    hasCamera,
    hasAudioRecording,
    hasVideoPlayback,
    needsCameraPermission: hasImagePicker || hasCamera,
    needsMicrophone: hasAudioRecording || hasVideoRecording,
  };
}

function buildInfoPlist(capabilities) {
  const { needsCameraPermission, needsMicrophone } = mediaCapabilities(capabilities);
  const infoPlist = {};
  if (capabilities.includes("imagePicker")) infoPlist.NSPhotoLibraryUsageDescription = PERMISSION_TEXT.photos;
  if (needsCameraPermission) infoPlist.NSCameraUsageDescription = PERMISSION_TEXT.camera;
  if (needsMicrophone) infoPlist.NSMicrophoneUsageDescription = PERMISSION_TEXT.microphone;
  if (capabilities.includes("location")) infoPlist.NSLocationWhenInUseUsageDescription = PERMISSION_TEXT.locationWhenInUse;
  if (capabilities.includes("backgroundLocation")) {
    infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription = PERMISSION_TEXT.locationAlwaysAndWhenInUse;
  }
  if (capabilities.includes("localAuthentication")) infoPlist.NSFaceIDUsageDescription = PERMISSION_TEXT.faceId;
  return infoPlist;
}

function buildAndroidConfig(appKey, app, capabilities, googleServicesFile) {
  const { needsMicrophone } = mediaCapabilities(capabilities);
  const adaptiveIcon = appAsset(appKey, "adaptive-icon.png");
  const android = {
    package: app.androidPackage,
    blockedPermissions: needsMicrophone ? [] : ["android.permission.RECORD_AUDIO"],
  };
  if (adaptiveIcon) {
    android.adaptiveIcon = { foregroundImage: adaptiveIcon, backgroundColor: "#FFFFFF" };
  }
  if (capabilities.includes("notifications") && googleServicesFile) {
    android.googleServicesFile = googleServicesFile;
  }
  const androidMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_ANDROID_API_KEY", appKey);
  if (capabilities.includes("maps") && androidMapsKey) {
    android.config = { googleMaps: { apiKey: androidMapsKey } };
  }
  return android;
}

function buildIosConfig(appKey, app, capabilities) {
  const ios = {
    bundleIdentifier: app.iosBundleIdentifier,
    supportsTablet: false,
    infoPlist: buildInfoPlist(capabilities),
  };
  const iosMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_IOS_API_KEY", appKey);
  if (capabilities.includes("maps") && iosMapsKey) {
    ios.config = { googleMapsApiKey: iosMapsKey };
  }
  return ios;
}

function buildSentryPlugin(sentry) {
  if (!sentry.dsn || !sentry.organization || !sentry.project) return undefined;
  return [
    "@sentry/react-native/expo",
    {
      organization: sentry.organization,
      project: sentry.project,
      ...(sentry.url ? { url: sentry.url } : {}),
    },
  ];
}

function buildPlugins(appKey, capabilities, sentry) {
  const {
    hasCamera,
    hasAudioRecording,
    hasVideoPlayback,
    needsCameraPermission,
    needsMicrophone,
  } = mediaCapabilities(capabilities);
  const plugins = [];

  if (capabilities.includes("imagePicker") && hasRuntimeDependency(appKey, "expo-image-picker")) {
    plugins.push([
      "expo-image-picker",
      {
        photosPermission: PERMISSION_TEXT.photos,
        cameraPermission: needsCameraPermission ? PERMISSION_TEXT.camera : false,
        microphonePermission: needsMicrophone ? PERMISSION_TEXT.microphone : false,
      },
    ]);
  }
  if (capabilities.includes("documentPicker") && hasRuntimeDependency(appKey, "expo-document-picker")) {
    plugins.push("expo-document-picker");
  }

  const sentryPlugin = buildSentryPlugin(sentry);
  if (sentryPlugin) plugins.push(sentryPlugin);

  if (capabilities.includes("maps") && hasRuntimeDependency(appKey, "react-native-maps")) {
    const androidMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_ANDROID_API_KEY", appKey);
    const iosMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_IOS_API_KEY", appKey);
    const options = {
      ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
      ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
    };
    plugins.push(Object.keys(options).length > 0 ? ["react-native-maps", options] : "react-native-maps");
  }

  if (capabilities.includes("router")) plugins.push("expo-router");
  if (capabilities.includes("updates")) plugins.push("expo-updates");
  plugins.push("expo-system-ui");

  if (capabilities.includes("splashScreen")) {
    const splashIcon = appAsset(appKey, "splash-icon.png");
    plugins.push(
      splashIcon
        ? ["expo-splash-screen", { image: splashIcon, imageWidth: 220, resizeMode: "contain", backgroundColor: "#FFFFFF" }]
        : "expo-splash-screen",
    );
  }
  if (capabilities.includes("localAuthentication")) {
    plugins.push(["expo-local-authentication", { faceIDPermission: PERMISSION_TEXT.faceId }]);
  }
  if (hasAudioRecording) {
    plugins.push([
      "expo-audio",
      {
        microphonePermission: PERMISSION_TEXT.microphone,
        recordAudioAndroid: true,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ]);
  }
  if (hasCamera && hasRuntimeDependency(appKey, "expo-camera")) {
    plugins.push([
      "expo-camera",
      {
        cameraPermission: PERMISSION_TEXT.camera,
        microphonePermission: needsMicrophone ? PERMISSION_TEXT.microphone : false,
        recordAudioAndroid: needsMicrophone,
      },
    ]);
  }
  if (hasVideoPlayback) plugins.push("expo-video");
  if (capabilities.includes("sharing")) plugins.push("expo-sharing");
  if (capabilities.includes("webBrowser")) plugins.push("expo-web-browser");
  if (capabilities.includes("sqlite")) plugins.push("expo-sqlite");
  if (capabilities.includes("taskManager")) plugins.push("expo-task-manager");
  if (capabilities.includes("backgroundTask")) plugins.push("expo-background-task");
  if (capabilities.includes("backgroundLocation")) {
    plugins.push([
      "expo-location",
      {
        locationWhenInUsePermission: PERMISSION_TEXT.locationWhenInUse,
        locationAlwaysAndWhenInUsePermission: PERMISSION_TEXT.locationAlwaysAndWhenInUse,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ]);
  } else if (capabilities.includes("location")) {
    plugins.push(["expo-location", { locationWhenInUsePermission: PERMISSION_TEXT.locationWhenInUse }]);
  }
  if (capabilities.includes("notifications")) {
    const notificationIcon = appAsset(appKey, "notification-icon.png");
    plugins.push([
      "expo-notifications",
      {
        defaultChannel: "bthwani-operational",
        ...(notificationIcon ? { icon: notificationIcon } : {}),
      },
    ]);
  }
  if (capabilities.includes("secureStore")) plugins.push("expo-secure-store");

  return plugins;
}

function defineSamrimExpoApp(appKey) {
  const app = readMobileConfig(appKey);
  const capabilities = app.nativeCapabilities ?? [];
  const sentry = resolveSentryEnvironment(appKey);
  const googleServicesFile = resolveGoogleServicesFile(appKey, process.env);
  const androidMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_ANDROID_API_KEY", appKey);
  const iosMapsKey = resolveAppEnvironmentValue("GOOGLE_MAPS_IOS_API_KEY", appKey);
  const sentryNativeConfigured = Boolean(sentry.dsn && sentry.organization && sentry.project);
  const hasMapsCapability = capabilities.includes("maps");

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
      url: `https://u.expo.dev/${app.projectId}`,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    android: buildAndroidConfig(appKey, app, capabilities, googleServicesFile),
    ios: buildIosConfig(appKey, app, capabilities),
    plugins: buildPlugins(appKey, capabilities, sentry),
    ...(capabilities.includes("router") ? { experiments: { typedRoutes: true } } : {}),
    extra: {
      appKey,
      appLine: "next",
      sourceRepo: "samrim",
      nativeCapabilities: capabilities,
      sentry: {
        enabled: Boolean(sentry.dsn),
        nativeConfigured: sentryNativeConfigured,
        dsn: sentry.dsn,
        organization: sentry.organization,
        project: sentry.project,
        environment: sentry.appEnvironment,
        tracesSampleRate: sentry.tracesSampleRate,
        debug: sentry.debug,
        startupProbe: sentry.startupProbe,
      },
      notifications: {
        androidNativeConfigured: Boolean(googleServicesFile),
      },
      maps: {
        androidNativeConfigured: Boolean(hasMapsCapability && androidMapsKey),
        iosNativeConfigured: Boolean(hasMapsCapability && iosMapsKey),
        nativeDependencyInstalled: hasRuntimeDependency(appKey, "react-native-maps"),
      },
      eas: { projectId: app.projectId },
    },
  };
}

module.exports = { defineSamrimExpoApp };
