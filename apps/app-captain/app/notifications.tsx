import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { OrderAlertPreferences } from "../src/features/notifications/order-alert-preferences";
import { CaptainProtectedScreen } from "../src/shell/captain-protected-screen";
import { CaptainScrollScreen } from "../src/shell/captain-shell";

export default function CaptainNotificationsRoute() {
  return (
    <CaptainProtectedScreen>
      <CaptainScrollScreen>
        <NotificationsInbox />
        <OrderAlertPreferences />
      </CaptainScrollScreen>
    </CaptainProtectedScreen>
  );
}
