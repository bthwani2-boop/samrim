import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { CaptainScrollScreen } from "../src/shell/captain-shell";

export default function CaptainNotificationsRoute() {
  return <CaptainScrollScreen><NotificationsInbox /></CaptainScrollScreen>;
}
