import { type Href, useRouter } from "expo-router";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useAppearanceTheme, BthwaniIcon } from "@bthwani/design-system/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PartnerMore } from "../../../src/features/partner-onboarding/partner-more";
import { PartnerSurfaceGate } from "../../../src/shell/partner-surface-gate";
import { PartnerScrollScreen } from "../../../src/shell/partner-shell";

export default function PartnerMoreRoute() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = Platform.OS !== "web" || width < 1024;
  return <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
    <PartnerScrollScreen><PartnerSurfaceGate surface="more">
      {compact ? <Pressable accessibilityRole="button" accessibilityLabel="فتح حسابي وملف الانضمام والاتفاقيات"
        onPress={() => router.push("/account" as Href)}
        style={({pressed}) => ({ minHeight: 64, borderRadius: 13, borderWidth: 1,
          borderColor: theme.borderColor, backgroundColor: theme.surface, padding: 13,
          flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}>
        <BthwaniIcon name="account" size={23} color={theme.brandAction} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.color, fontSize: 15, fontWeight: "800", textAlign: "right" }}>حسابي وملف المتجر</Text>
          <Text style={{ color: theme.colorMuted, fontSize: 12, textAlign: "right" }}>ملف الانضمام · الاتفاقيات · المحفظة</Text>
        </View>
        <BthwaniIcon name="back" size={17} color={theme.colorMuted} />
      </Pressable> : null}
      <PartnerMore />
    </PartnerSurfaceGate></PartnerScrollScreen>
  </SafeAreaView>;
}
