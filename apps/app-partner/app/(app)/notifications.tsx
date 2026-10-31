import { useAppearanceTheme } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NotificationsInbox } from "../../src/features/notifications/notifications-inbox";
import { OrderAlertPreferences } from "../../src/features/notifications/order-alert-preferences";
import { PartnerAccessInvitationsCard } from "../../src/features/partner-onboarding/partner-access-invitations";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

/** The authenticated partner workspace owns both this route and its identity boundary. */
export default function PartnerNotificationsRoute() {
  const theme = useAppearanceTheme();
  return <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <PartnerScrollScreen>
      <NotificationsInbox />
      <PartnerAccessInvitationsCard />
      <OrderAlertPreferences />
    </PartnerScrollScreen>
  </SafeAreaView>;
}
