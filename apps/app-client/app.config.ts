import type { ExpoConfig } from "expo/config";
import { defineSamrimExpoApp } from "../../tools/mobile/define-samrim-expo-app.cjs";

const config = defineSamrimExpoApp("app-client");
type ExpoPlugin = NonNullable<ExpoConfig["plugins"]>[number];

const plugins = (config.plugins ?? []).map<ExpoPlugin>((plugin: ExpoPlugin) =>
  plugin === "expo-video"
    ? ["expo-video", { supportsPictureInPicture: true }]
    : plugin,
);

const appConfig: ExpoConfig = {
  ...config,
  plugins,
};

export default appConfig;