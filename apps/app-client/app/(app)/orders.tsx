import ClientOrders from "../../src/features/orders/orders";
import { ClientProtectedScreen } from "../../src/shell/client-protected-screen";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ClientOrdersRoute() {
  const theme = useAppearanceTheme();
  return <ClientProtectedScreen><SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}>
      <ClientOrders />
    </ScrollView>
  </SafeAreaView></ClientProtectedScreen>;
}