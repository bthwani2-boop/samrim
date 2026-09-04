import * as Sentry from "@sentry/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { MobileRuntimeProviders, sentryEnabled } from "../src/index";

function RootLayout() {
  return (
    <MobileRuntimeProviders>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </MobileRuntimeProviders>
  );
}

export default sentryEnabled ? Sentry.wrap(RootLayout) : RootLayout;
