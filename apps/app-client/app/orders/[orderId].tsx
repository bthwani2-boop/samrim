import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";
import ClientOrderDetail from "../../src/features/orders/order-detail";
import { ClientScrollScreen } from "../../src/shell/client-shell";
import { ClientProtectedScreen } from "../../src/shell/client-protected-screen";

export default function ClientOrderDetailRoute() {
  const theme = useAppearanceTheme();
  return <ClientProtectedScreen><SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <ClientScrollScreen><ClientOrderDetail /></ClientScrollScreen>
  </SafeAreaView></ClientProtectedScreen>;
}
