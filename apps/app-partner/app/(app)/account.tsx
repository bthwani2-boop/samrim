import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PartnerAccountEssentials } from "../../src/features/account/partner-account-essentials";
import { PartnerMore } from "../../src/features/partner-onboarding/partner-more";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";
import { PartnerSurfaceGate } from "../../src/shell/partner-surface-gate";

/** Account settings are a real workspace destination, not a redirect to More. */
export default function PartnerAccountRoute() {
  const theme = useAppearanceTheme();
  return <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <PartnerScrollScreen>
      <PartnerSurfaceGate surface="account">
        <PartnerAccountEssentials showStoreSelector />
        <PartnerMore accountOnly />
      </PartnerSurfaceGate>
    </PartnerScrollScreen>
  </SafeAreaView>;
}
