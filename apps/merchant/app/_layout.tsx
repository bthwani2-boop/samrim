import { createStage4Root } from "@bthwani/tamagui-config/preview";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";

// Original native identity and app-scoped preference key stay app-owned.
export default createStage4Root(
  "bthwani.stage4.merchant.theme",
  SecureStore.getItemAsync,
  SecureStore.setItemAsync,
  backgroundColor => (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }}>
      {/* Access remains denied until Identity Merchant session and DSH Store scope are verified by their owners. */}
      <Stack.Protected guard={false} redirectTo="/">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="orders/[id]" />
        <Stack.Screen name="products/[id]" />
        <Stack.Screen name="products/export" />
        <Stack.Screen name="products/import" />
        <Stack.Screen name="products/quick-prices" />
        <Stack.Screen name="promotions/index" />
        <Stack.Screen name="store/agreements" />
        <Stack.Screen name="store/availability" />
        <Stack.Screen name="store/captains" />
        <Stack.Screen name="store/index" />
        <Stack.Screen name="store/profile" />
        <Stack.Screen name="store/public-link" />
        <Stack.Screen name="store/team" />
        <Stack.Screen name="account" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="employees" />
        <Stack.Screen name="insights" />
        <Stack.Screen name="notifications" />
      </Stack.Protected>
    </Stack>
  ),
);
