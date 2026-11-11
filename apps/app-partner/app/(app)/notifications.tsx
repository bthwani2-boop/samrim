import { useAppearanceTheme } from "@bthwani/design-system/native";
import { OrderAlertPreferences } from "@bthwani/push-device/order-alert-preferences";
import { SafeAreaView } from "react-native-safe-area-context";
import { currentIdentityState, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { NotificationsInbox } from "../../src/features/notifications/notifications-inbox";
import { PartnerAccessInvitationsCard } from "../../src/features/partner-onboarding/partner-access-invitations";
import { PartnerScrollScreen } from "../../src/shell/partner-shell";

/** The authenticated partner workspace owns both this route and its identity boundary. */
export default function PartnerNotificationsRoute() {
  const theme = useAppearanceTheme();
  return <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <PartnerScrollScreen>
      <NotificationsInbox />
      <PartnerAccessInvitationsCard />
      <OrderAlertPreferences currentIdentityState={currentIdentityState} subscribeIdentitySession={subscribeIdentitySession} />
    </PartnerScrollScreen>
  </SafeAreaView>;
}
