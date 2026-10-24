import { StyleSheet, Text, View } from "react-native";
import { useAppearanceTheme } from "./appearance";

/**
 * Read-only connectivity notice. Do not trigger a request or financial retry
 * from a network event: the server remains the source of truth.
 */
export function BthwaniNetworkStatusNotice({ top, offline }: { top: number; offline: boolean }) {
  const theme = useAppearanceTheme();
  if (!offline) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="none"
      style={[styles.notice, { top: top + 8, backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}
    >
      <Text style={[styles.label, { color: theme.dangerText }]}>لا يوجد اتصال بالإنترنت</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: "absolute",
    zIndex: 1000,
    left: 16,
    right: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
  },
  label: { fontSize: 13, fontWeight: "600", textAlign: "center" },
});
