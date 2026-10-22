import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";
import ClientOrderDetail from "../../../src/features/orders/order-detail";
import { ClientScrollScreen } from "../../../src/shell/client-shell";

export default function ClientOrderDetailRoute() {
  const theme = useAppearanceTheme();
  return <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <ClientScrollScreen><ClientOrderDetail /></ClientScrollScreen>
  </SafeAreaView>;
}
