import { StyleSheet } from "react-native";

import { direction, resolveLogicalTextStyle, resolveTextInputAlign, resolveTheme } from "@bthwani/design-system";

export function createFieldOperationStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const logicalText = resolveLogicalTextStyle(activeDirection);
  const logicalInput = { textAlign: resolveTextInputAlign("start", activeDirection), writingDirection: activeDirection } as const;
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, marginTop: 16, padding: 14, width: "100%", direction: activeDirection },
    title: { ...logicalText, color: theme.color, fontSize: 18, fontWeight: "800" },
    sectionTitle: { ...logicalText, color: theme.color, fontSize: 15, fontWeight: "800", marginTop: 6 },
    muted: { ...logicalText, color: theme.colorMuted, fontSize: 13, lineHeight: 19 },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 7, padding: 10 },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: 8, gap: 7, padding: 10 },
    cardTitle: { ...logicalText, color: theme.color, fontSize: 14, fontWeight: "800" },
    label: { ...logicalText, color: theme.color, fontSize: 13, fontWeight: "700" },
    input: { ...logicalInput, backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 12 },
    phoneInput: { textAlign: resolveTextInputAlign("start", "ltr"), writingDirection: "ltr" },
    optionList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    optionButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    optionButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground },
    optionText: { ...logicalText, color: theme.color, fontSize: 13, fontWeight: "700" },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, flexDirection: "row", justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
    successCard: { backgroundColor: theme.successSoft, borderColor: theme.success, borderRadius: 8, borderWidth: 1, gap: 7, padding: 10 },
    successText: { ...logicalText, color: theme.success, fontSize: 13, fontWeight: "800" },
    optionsError: { gap: 8 },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    error: { ...logicalText, color: theme.danger, fontSize: 13 },
  });
}
