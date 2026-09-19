import { radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createPartnerSurfaceStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[4], width: "100%" },
    sectionTitle: { ...typography.hero, color: theme.color },
    value: { ...typography.titleMd, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: 1, gap: spacing[3], padding: spacing[4] },
    headerRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    headerCopy: { flex: 1, gap: spacing[1] },
    metaGrid: { flexDirection: "row", gap: spacing[2] },
    metaItem: { backgroundColor: theme.surfaceInset, borderRadius: radius.md, flex: 1, gap: spacing[1], padding: spacing[3] },
    metaLabel: { ...typography.caption, color: theme.colorMuted },
    error: { ...typography.label, backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, padding: spacing[2] },
  });
}
