import ClientWallet from "../src/features/wallet/wallet";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ClientProtectedScreen } from "../src/shell/client-protected-screen";

export default function ClientWalletRoute() {
  const theme = useAppearanceTheme();
  return <ClientProtectedScreen><SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}><ClientWallet /></SafeAreaView></ClientProtectedScreen>;
}
