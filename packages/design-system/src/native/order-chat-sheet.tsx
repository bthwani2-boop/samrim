import type { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { typography } from "../index";
import { useAppearanceTheme } from "./appearance";

type Props = PropsWithChildren<Readonly<{
  visible: boolean;
  onClose: () => void;
  orderReference: string;
  status: string;
  summary: string;
  total?: string;
  onDetails?: () => void;
}>>;

/** A single order-scoped chat surface. Message permissions and contents remain owned by DSH. */
export function BthwaniOrderChatSheet({ visible, onClose, orderReference, status, summary, total, onDetails, children }: Props) {
  const theme = useAppearanceTheme();
  return <Modal transparent statusBarTranslucent animationType="slide" visible={visible} onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel="إغلاق المحادثة" style={StyleSheet.absoluteFill} onPress={onClose}/>
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={[styles.grabber, { backgroundColor: theme.borderColor }]}/>
        <View style={[styles.titleRow, { borderBottomColor: theme.borderColor }]}>
          <View style={styles.titleText}>
            <Text style={[styles.title, { color: theme.color }]} numberOfLines={1}>محادثة الطلب #{orderReference}</Text>
            <Text style={[styles.hint, { color: theme.colorMuted }]} numberOfLines={1}>{status}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق محادثة الطلب" style={[styles.close, { backgroundColor: theme.surfaceRaised }]} onPress={onClose}>
            <Text style={[styles.closeText, { color: theme.color }]}>إغلاق</Text>
          </Pressable>
        </View>
        <View style={[styles.summary, { backgroundColor: theme.surface, borderColor: theme.borderColor }]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryMain, { color: theme.color }]} numberOfLines={1}>{summary}</Text>
            {total ? <Text style={[styles.total, { color: theme.color }]} numberOfLines={1}>{total}</Text> : null}
          </View>
          {onDetails ? <Pressable accessibilityRole="button" accessibilityLabel="عرض تفاصيل الطلب" onPress={onDetails}>
            <Text style={[styles.detailsLink, { color: theme.brandAction }]}>عرض تفاصيل الطلب ←</Text>
          </Pressable> : null}
        </View>
        <View style={styles.contents}>
          {children}
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000099" },
  sheet: { height: "88%", maxHeight: "91%", minHeight: "58%", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, overflow: "hidden" },
  grabber: { width: 38, height: 4, borderRadius: 4, alignSelf: "center", marginBottom: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 11, borderBottomWidth: 1, gap: 10 },
  titleText: { flex: 1, gap: 4 }, title: { ...typography.bodyStrong, fontWeight: "800", fontSize: 15 }, hint: { ...typography.caption },
  close: { paddingHorizontal: 12, minHeight: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  closeText: { ...typography.label },
  summary: { borderWidth: 1, borderRadius: 12, padding: 10, marginHorizontal: 12, marginTop: 10, gap: 5 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  summaryMain: { ...typography.bodySm, flex: 1 }, total: { ...typography.bodyStrong, fontWeight: "800" },
  detailsLink: { ...typography.caption, fontWeight: "800", paddingVertical: 5 },
  contents: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 20 },
});
