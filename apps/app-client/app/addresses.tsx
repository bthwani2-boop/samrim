import LocationCore from "../src/features/location-core/location-core";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClientScrollScreen } from "../src/shell/client-shell";
import { ClientProtectedScreen } from "../src/shell/client-protected-screen";

export default function ClientAddressesRoute() {
  const theme = useAppearanceTheme();
  return <ClientProtectedScreen><SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}><ClientScrollScreen><LocationCore /></ClientScrollScreen></SafeAreaView></ClientProtectedScreen>;
}
