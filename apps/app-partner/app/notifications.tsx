import { NotificationsInbox } from "../src/features/notifications/notifications-inbox";
import { PartnerScrollScreen } from "../src/shell/partner-shell";

export default function PartnerNotificationsRoute() {
  return <PartnerScrollScreen><NotificationsInbox /></PartnerScrollScreen>;
}
