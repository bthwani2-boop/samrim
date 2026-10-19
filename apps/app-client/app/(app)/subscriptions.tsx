import { radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { StyleSheet, Text, View } from "react-native";
import { ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientSubscriptions() {
  const theme = useAppearanceTheme();
  return (
    <ClientScrollScreen>
      <BthwaniSurface accessibilityLabel="الاشتراكات" tone="inset" style={{ borderRadius: radius.xl, marginTop: spacing[3], padding: spacing[5] }}>
        <View style={styles.content}>
          <BthwaniIcon name="gifts" color={theme.colorMuted} />
          <Text style={[typography.titleSm, { color: theme.color, textAlign: "center" }]}>لا توجد اشتراكات متاحة حاليًا</Text>
        </View>
      </BthwaniSurface>
    </ClientScrollScreen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", gap: spacing[3] },
});
