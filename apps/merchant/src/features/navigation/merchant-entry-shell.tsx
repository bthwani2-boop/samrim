import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

export default function MerchantEntryShell({ children }: Readonly<{ children: ReactNode }>) {
  const { theme } = useMobileAppearance();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      {children}
    </SafeAreaView>
  );
}
