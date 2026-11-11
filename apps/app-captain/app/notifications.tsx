import { OrderAlertPreferences } from "@bthwani/push-device/order-alert-preferences";
import { currentIdentityState, subscribeIdentitySession } from "../src/bootstrap/identity";
import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { CaptainProtectedScreen } from "../src/shell/captain-protected-screen";
import { CaptainScrollScreen } from "../src/shell/captain-shell";

export default function CaptainNotificationsRoute() {
  return (
    <CaptainProtectedScreen>
      <CaptainScrollScreen>
        <NotificationsInbox />
        <OrderAlertPreferences currentIdentityState={currentIdentityState} subscribeIdentitySession={subscribeIdentitySession} />
      </CaptainScrollScreen>
    </CaptainProtectedScreen>
  );
}
