import * as React from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Stack } from "expo-router";
import { TamaguiProvider, Theme } from "tamagui";
import { AppearanceProvider, createMobileAppearanceController, useMobileAppearance } from "@bthwani/design-system/native/appearance";
import { tamaguiConfig } from "@bthwani/tamagui-config";

function AppRoutes() {
  const { themeName, theme } = useMobileAppearance();
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={themeName}>
      <Theme name={themeName}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />
      </Theme>
    </TamaguiProvider>
  );
}

// A standalone stage-4 preview: no authentication or commercial data is used.
// Account-scoped preference keys will be introduced with the real Identity owner.
export default function RootLayout() {
  const storage = React.useMemo(() => {
    let webPreference: string | null = null;
    return Platform.OS === "web"
      ? { getItem: async (_key: string) => webPreference, setItem: async (_key: string, value: string) => { webPreference = value; } }
      : { getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync };
  }, []);
  const controller = React.useMemo(() => createMobileAppearanceController({
    storage,
    key: "bthwani.stage4.customer.theme",
  }), [storage]);
  React.useEffect(() => () => controller.dispose(), [controller]);
  return <AppearanceProvider controller={controller}><AppRoutes /></AppearanceProvider>;
}
