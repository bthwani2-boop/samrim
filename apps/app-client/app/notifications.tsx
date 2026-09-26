import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { ClientScrollScreen } from "../src/shell/client-shell";

export default function ClientNotificationsRoute() {
  return <ClientScrollScreen><NotificationsInbox /></ClientScrollScreen>;
}
