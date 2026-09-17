import { StyleSheet } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";

export function createFieldOperationStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, marginTop: 16, padding: 14, width: "100%", direction: activeDirection },
    title: { color: theme.color, fontSize: 18, fontWeight: "800", textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 15, fontWeight: "800", marginTop: 6, textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 7, padding: 10 },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: 8, gap: 7, padding: 10 },
    cardTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    label: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 12, textAlign: startTextAlign },
    optionList: { flexDirection: rowDirection, flexWrap: "wrap", gap: 8 },
    optionButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    optionButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground },
    optionText: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, flexDirection: rowDirection, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
