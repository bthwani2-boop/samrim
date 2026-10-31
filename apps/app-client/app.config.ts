import { defineSamrimExpoApp } from "../../tools/mobile/define-samrim-expo-app.cjs";

export default {
  ...defineSamrimExpoApp("app-client", { locationMode: "foreground", maps: true, web: true }),
  web: { bundler: "metro" as const, output: "server" as const },
};
