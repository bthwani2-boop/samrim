import { StyleSheet } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";

export function createPartnerSurfaceStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { direction: activeDirection, gap: 8, width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: 8, paddingVertical: 16, width: "100%" },
    sectionTitle: { color: theme.color, fontSize: 16, fontWeight: "800", textAlign: startTextAlign },
    value: { color: theme.color, fontSize: 15, fontWeight: "700", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    error: { backgroundColor: theme.dangerSoft, borderRadius: 10, color: theme.danger, fontSize: 13, padding: 10, textAlign: startTextAlign },
    linkButton: { alignItems: "center", borderColor: theme.interactiveText, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    linkText: { color: theme.interactiveText, fontWeight: "800", textAlign: "center" },
  });
}
