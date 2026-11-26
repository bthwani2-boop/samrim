import { createMobileAppearanceRoot } from "@bthwani/tamagui-config/appearance";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";

// Keep the registered app's persisted preference key across upgrades.
export default createMobileAppearanceRoot(
  "bthwani.stage4.customer.theme",
  SecureStore.getItemAsync,
  SecureStore.setItemAsync,
  backgroundColor => <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }} />,
);
