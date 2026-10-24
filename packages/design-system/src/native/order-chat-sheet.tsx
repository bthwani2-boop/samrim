import { useEffect, useState, type PropsWithChildren } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { typography } from "../index";
import { useAppearanceTheme } from "./appearance";

type Detail = Readonly<{ id?: string; label: string; value: string }>;
type Props = PropsWithChildren<Readonly<{
  visible: boolean;
  onClose: () => void;
  orderReference: string;
  status: string;
  summary: string;
  quickFacts?: string;
  total?: string;
  details?: ReadonlyArray<Detail>;
  bottomInset?: number;
}>>;

/** Keep order context in the chat: one compact summary and optional inline disclosure. */
export function BthwaniOrderChatSheet({
  visible, onClose, orderReference, status, summary, quickFacts, total, details = [], bottomInset = 20, children,
}: Props) {
  const theme = useAppearanceTheme();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (visible && orderReference) setExpanded(false); }, [orderReference, visible]);

  return <Modal transparent statusBarTranslucent animationType="slide" visible={visible} onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Pressable accessibilityRole="button" accessibilityLabel="إغلاق المحادثة" style={StyleSheet.absoluteFill} onPress={onClose}/>
      <View accessibilityViewIsModal style={[styles.sheet, {backgroundColor: theme.background, paddingBottom: Math.max(bottomInset, 12)}]}>
        <View style={[styles.grabber, {backgroundColor: theme.borderColor}]}/>
        <View style={[styles.titleRow, {borderBottomColor: theme.borderColor}]}>
          <View style={styles.titleText}>
            <Text style={[styles.title, {color: theme.color}]} numberOfLines={1}>محادثة الطلب #{orderReference}</Text>
            <Text style={[styles.hint, {color: theme.colorMuted}]} numberOfLines={1}>{status}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق محادثة الطلب" style={styles.close} onPress={onClose}>
            <Text style={[styles.closeText, {color: theme.colorMuted}]}>إغلاق</Text>
          </Pressable>
        </View>
        <View style={[styles.summary, {backgroundColor: theme.surface, borderColor: theme.borderColor}]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryMain, {color: theme.color}]} numberOfLines={1}>{summary}</Text>
            {total ? <Text style={[styles.total, {color: theme.color}]} numberOfLines={1}>{total}</Text> : null}
            {details.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "إخفاء تفاصيل الطلب" : "إظهار تفاصيل الطلب"}
              accessibilityState={{expanded}} onPress={() => setExpanded(value => !value)} style={styles.detailsToggle}>
              <Text style={[styles.detailsLink, {color: theme.brandAction}]}>{expanded ? "أقل ⌃" : "تفاصيل ⌄"}</Text>
            </Pressable> : null}
          </View>
          {quickFacts ? <Text style={[styles.quickFacts, {color: theme.colorMuted}]} numberOfLines={1}>{quickFacts}</Text> : null}
          {expanded && details.length > 0 ? <ScrollView nestedScrollEnabled style={styles.detailsScroll} contentContainerStyle={styles.detailsContents}>
            {details.map((detail) => <View key={detail.id ?? `${detail.label}:${detail.value}`} style={styles.detailRow}>
              <Text style={[styles.detailLabel, {color: theme.colorMuted}]}>{detail.label}</Text>
              <Text selectable style={[styles.detailValue, {color: theme.color}]}>{detail.value}</Text>
            </View>)}
          </ScrollView> : null}
        </View>
        <View style={styles.contents}>{children}</View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: {flex: 1, justifyContent: "flex-end", backgroundColor: "#00000099"},
  sheet: {height: "88%", maxHeight: "91%", minHeight: "58%", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, overflow: "hidden"},
  grabber: {width: 38, height: 4, borderRadius: 4, alignSelf: "center", marginBottom: 7},
  titleRow: {flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1, gap: 8},
  titleText: {flex: 1, gap: 2}, title: {...typography.bodyStrong, fontWeight: "800", fontSize: 14}, hint: {...typography.caption},
  close: {paddingHorizontal: 8, minHeight: 35, alignItems: "center", justifyContent: "center"},
  closeText: {...typography.label},
  summary: {borderWidth: 1, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 9, marginHorizontal: 12, marginTop: 8},
  summaryRow: {minHeight: 37, flexDirection: "row", alignItems: "center", gap: 9},
  summaryMain: {...typography.bodySm, flex: 1}, total: {...typography.bodyStrong, fontWeight: "800", fontSize: 12},
  quickFacts: {...typography.caption, fontSize: 11, paddingBottom: 3},
  detailsToggle: {minHeight: 36, paddingHorizontal: 5, alignItems: "center", justifyContent: "center"},
  detailsLink: {...typography.caption, fontWeight: "800"},
  detailsScroll: {maxHeight: 154, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#B9B9B955"},
  detailsContents: {paddingVertical: 6, gap: 5},
  detailRow: {flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 2},
  detailLabel: {...typography.caption, width: 67},
  detailValue: {...typography.bodySm, flex: 1, textAlign: "left"},
  contents: {flex: 1, minHeight: 0, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 7},
});
