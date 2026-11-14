import * as SecureStore from "expo-secure-store";
import { Stack } from "expo-router";
import { createStage4Root } from "@bthwani/tamagui-config/preview";

// Original native identity and app-scoped preference key stay app-owned.
export default createStage4Root(
  "bthwani.stage4.merchant.theme",
  SecureStore.getItemAsync,
  SecureStore.setItemAsync,
  backgroundColor => <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }} />,
);
