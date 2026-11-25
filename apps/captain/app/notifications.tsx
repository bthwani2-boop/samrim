import CaptainCapabilityScreen from "../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../src/features/access/protected-route";
import CaptainDeviceNotificationSettings from "../src/features/notifications/device-notification-settings";

export default function CaptainNotificationsRoute() {
  return (
    <CaptainProtectedRoute>
      <CaptainCapabilityScreen title="الإشعارات" message="إشعارات المهام والمراسلات غير متاحة حتى تفعيل خدمة DSH." returnTo="/home">
        <CaptainDeviceNotificationSettings />
      </CaptainCapabilityScreen>
    </CaptainProtectedRoute>
  );
}
