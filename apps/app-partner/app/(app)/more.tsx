import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PartnerMore } from "../../src/features/partner-onboarding/partner-more";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

export default function PartnerMoreRoute() {
  const theme = useAppearanceTheme();
  return <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <PartnerScrollScreen><PartnerSurfaceGate surface="more"><PartnerMore /></PartnerSurfaceGate></PartnerScrollScreen>
  </SafeAreaView>;
}
