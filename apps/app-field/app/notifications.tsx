import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { FieldScrollScreen } from "../src/shell/field-shell";

export default function FieldNotificationsRoute() {
  return <FieldScrollScreen><NotificationsInbox /></FieldScrollScreen>;
}
