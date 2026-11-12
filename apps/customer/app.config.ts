import { defineBthwaniExpoApp } from "../../tools/mobile/define-bthwani-expo-app.cjs";

export default {
  ...defineBthwaniExpoApp("app-client", { locationMode: "foreground", maps: true, web: true }),
  web: { bundler: "metro" as const, output: "server" as const },
};
