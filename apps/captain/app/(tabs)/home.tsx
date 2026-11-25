import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { Pressable, Text } from "react-native";
import CaptainHomeScreen from "../../src/features/dispatch/captain-home-screen";
import CaptainDeviceLocationReadiness from "../../src/features/location/device-location-readiness";

export default function CaptainHomeRoute() {
  const { theme } = useMobileAppearance();
  return (
    <CaptainHomeScreen>
      <CaptainDeviceLocationReadiness />
      <Link href="/notifications" asChild>
        <Pressable testID="captain-notifications-link" accessibilityRole="link"
          style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 14, alignSelf: "flex-start",
            borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor }}>
          <Text style={{ color: theme.interactiveText, fontWeight: "600" }}>إعدادات الإشعارات</Text>
        </Pressable>
      </Link>
    </CaptainHomeScreen>
  );
}
