import * as React from "react";
import { ActivityIndicator, Modal, Pressable, type PressableProps, type PressableStateCallbackType, type StyleProp, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewProps, type ViewStyle } from "react-native";

import { borders, elevation, opacity, radius, sizing, spacing, type ThemeColors, typography } from "../tokens/index";
import { useAppearanceTheme } from "./appearance";
import { BthwaniIcon, type MobileIconName } from "./icons";

type SurfaceTone = "base" | "raised" | "inset";
type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function BthwaniSurface({ tone = "base", children, style, ...props }: ViewProps & { tone?: SurfaceTone }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const toneStyles: Record<SurfaceTone, ViewStyle> = {
    base: styles.surfaceBase,
    raised: styles.surfaceRaised,
    inset: styles.surfaceInset,
  };
  const toneStyle = toneStyles[tone];
  return <View {...props} style={[styles.surface, toneStyle, style]}>{children}</View>;
}

export function BthwaniButton({ label, variant = "primary", busy = false, disabled = false, style, ...props }: Omit<PressableProps, "children"> & { label: string; variant?: "primary" | "secondary" | "quiet" | "danger"; busy?: boolean }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const blocked = disabled || busy;
  const variantStyles = {
    primary: styles.buttonPrimary,
    secondary: styles.buttonSecondary,
    quiet: styles.buttonQuiet,
    danger: styles.buttonDanger,
  };
  const textVariantStyles = {
    primary: styles.buttonTextPrimary,
    secondary: styles.buttonTextSecondary,
    quiet: styles.buttonTextQuiet,
    danger: styles.buttonTextDanger,
  };
  const variantStyle = variantStyles[variant];
  const textVariantStyle = textVariantStyles[variant];
  let busyColor: string;
  if (variant === "primary") {
    busyColor = theme.onAction;
  } else if (variant === "danger") {
    busyColor = theme.danger;
  } else {
    busyColor = theme.interactiveText;
  }
  return (
    <Pressable
      {...props}
      accessibilityRole={props.accessibilityRole ?? "button"}
      accessibilityState={{ ...props.accessibilityState, busy, disabled: blocked }}
      disabled={blocked}
      style={(state) => [styles.button, variantStyle, blocked && styles.buttonDisabled, state.pressed && !blocked && styles.buttonPressed, resolvePressableStyle(style, state)]}
    >
      {busy ? <ActivityIndicator color={busyColor} /> : <Text style={[styles.buttonText, textVariantStyle, blocked && styles.buttonTextDisabled]}>{label}</Text>}
    </Pressable>
  );
}

export function BthwaniNavigationRow({ compact = false, description, icon, onPress, style, title, ...props }: Omit<PressableProps, "children" | "onPress"> & { compact?: boolean; description: string; icon: MobileIconName; onPress: NonNullable<PressableProps["onPress"]>; title: string }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const disabled = Boolean(props.disabled);
  return (
    <Pressable
      {...props}
      accessibilityLabel={props.accessibilityLabel ?? [title, description].join("، ")}
      accessibilityHint={props.accessibilityHint ?? description}
      accessibilityRole={props.accessibilityRole ?? "button"}
      accessibilityState={{ ...props.accessibilityState, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => [compact ? styles.navigationRowCompact : styles.navigationRow, disabled && styles.navigationRowDisabled, state.pressed && !disabled && styles.buttonPressed, resolvePressableStyle(style, state)]}
    >
      <View style={[styles.navigationRowIcon, compact && styles.navigationRowIconCompact]}>
        <BthwaniIcon name={icon} color={theme.interactiveText} size={compact ? sizing.iconSm : sizing.iconLg} />
      </View>
      <View style={styles.navigationRowCopy}>
        <Text style={styles.navigationRowTitle}>{title}</Text>
        <Text style={styles.navigationRowDescription}>{description}</Text>
      </View>
      <BthwaniIcon name="back" color={theme.colorMuted} size={sizing.iconMd} />
    </Pressable>
  );
}

export function BthwaniConfirmDialog({ visible, title, description, confirmLabel, cancelLabel = "إلغاء", busy = false, intent = "primary", onConfirm, onCancel, children }: Readonly<{ visible: boolean; title: string; description: string; confirmLabel: string; cancelLabel?: string; busy?: boolean; intent?: "primary" | "danger"; onConfirm: () => void; onCancel: () => void; children?: React.ReactNode }>) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const close = busy ? () => undefined : onCancel;
  return (
    <Modal animationType="fade" onRequestClose={close} statusBarTranslucent transparent visible={visible}>
      <View style={styles.dialogBackdrop}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.color, opacity: 0.36 }]} />
        <View accessibilityViewIsModal style={styles.dialogCard}>
          <Text accessibilityRole="header" style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogDescription}>{description}</Text>
          {children}
          <View style={styles.dialogActions}>
            <BthwaniButton disabled={busy} label={cancelLabel} onPress={onCancel} style={styles.dialogAction} variant="secondary" />
            <BthwaniButton busy={busy} label={confirmLabel} onPress={onConfirm} style={styles.dialogAction} variant={intent === "danger" ? "danger" : "primary"} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function BthwaniIconButton({ icon, label, tone = "surface", size = sizing.controlMd, style, ...props }: Omit<PressableProps, "children"> & { icon: MobileIconName; label: string; tone?: "surface" | "soft" | "primary"; size?: number }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const iconColor = tone === "primary" ? theme.onAction : theme.interactiveText;
  const toneStyles = {
    surface: styles.iconButtonSurface,
    soft: styles.iconButtonSoft,
    primary: styles.iconButtonPrimary,
  };
  const toneStyle = toneStyles[tone];
  return (
    <Pressable {...props} accessibilityLabel={label} accessibilityRole={props.accessibilityRole ?? "button"} hitSlop={props.hitSlop ?? 4} style={(state) => [styles.iconButton, toneStyle, { height: size, width: size }, state.pressed && styles.buttonPressed, resolvePressableStyle(style, state)]}>
      <BthwaniIcon name={icon} color={iconColor} size={sizing.iconMd} />
    </Pressable>
  );
}

export function BthwaniChip({ label, selected = false, icon, style, ...props }: Omit<PressableProps, "children"> & { label: string; selected?: boolean; icon?: MobileIconName }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const disabled = Boolean(props.disabled);
  let iconColor = theme.colorMuted;
  if (disabled) {
    iconColor = theme.disabledText;
  } else if (selected) {
    iconColor = theme.interactiveText;
  }
  return (
    <Pressable {...props} accessibilityRole={props.accessibilityRole ?? "button"} accessibilityState={{ ...props.accessibilityState, disabled, selected }} disabled={disabled} style={(state) => [styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled, state.pressed && !disabled && styles.buttonPressed, resolvePressableStyle(style, state)]}>
      {icon ? <BthwaniIcon name={icon} color={iconColor} size={sizing.iconSm} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected, disabled && styles.chipTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

export function BthwaniSearchField({ value, onChangeText, placeholder, accessibilityLabel, onClear, containerStyle, inputRef, ...props }: Omit<TextInputProps, "style"> & { containerStyle?: StyleProp<ViewStyle>; inputRef?: React.Ref<TextInput>; onClear?: (() => void) | undefined }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const hasValue = Boolean(value);
  const disabled = props.editable === false;
  return (
    <View style={[styles.searchField, containerStyle]}>
      <BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconMd} />
      <TextInput {...props} ref={inputRef} accessibilityLabel={accessibilityLabel} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.colorMuted} style={styles.searchInput} value={value} />
      {hasValue && onClear ? <BthwaniIconButton disabled={disabled} icon="close" label="مسح البحث" onPress={onClear} size={sizing.controlSm} tone="soft" /> : null}
    </View>
  );
}

export function BthwaniSectionHeader({ title, subtitle, actionLabel, onAction, style }: Readonly<{ title: string; subtitle?: string; actionLabel?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }>) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={styles.sectionAction}><Text style={styles.sectionActionText}>{actionLabel}</Text></Pressable> : null}
    </View>
  );
}

/**
 * A compact, semantic status treatment shared by role surfaces.
 * Product screens own the wording; the design system owns the visual grammar.
 */
export function BthwaniStatusBadge({ label, tone = "neutral", icon, accessibilityLabel }: Readonly<{ label: string; tone?: StatusTone; icon?: MobileIconName; accessibilityLabel?: string }>) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const palette = {
    neutral: { backgroundColor: theme.surfaceInset, color: theme.colorMuted },
    info: { backgroundColor: theme.infoSoft, color: theme.info },
    success: { backgroundColor: theme.successSoft, color: theme.success },
    warning: { backgroundColor: theme.warningSoft, color: theme.warning },
    danger: { backgroundColor: theme.dangerSoft, color: theme.danger },
  }[tone];
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? label} style={[styles.statusBadge, { backgroundColor: palette.backgroundColor }]}>
      {icon ? <BthwaniIcon name={icon} color={palette.color} size={sizing.iconSm} /> : null}
      <Text style={[styles.statusBadgeText, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

export function BthwaniSkeleton({ width = "100%", height = sizing.controlMd, style }: Readonly<{ width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }>) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  return <View accessibilityLabel="جارٍ التحميل" style={[styles.skeleton, { height, width }, style]} />;
}

function resolvePressableStyle(style: PressableProps["style"], state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return typeof style === "function" ? style(state) : style;
}

function createPrimitiveStyles(theme: ThemeColors) {
  return StyleSheet.create({
    surface: {},
    surfaceBase: { backgroundColor: theme.surface },
    surfaceRaised: { backgroundColor: theme.surfaceRaised, ...elevation.raised },
    surfaceInset: { backgroundColor: theme.surfaceInset },
    button: { alignItems: "center", borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[4] },
    buttonPrimary: { backgroundColor: theme.actionBackground },
    buttonSecondary: { backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderWidth: borders.hairline },
    buttonQuiet: { backgroundColor: theme.actionSoft },
    buttonDanger: { backgroundColor: theme.dangerSoft, borderColor: theme.danger, borderWidth: borders.hairline },
    buttonDisabled: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    buttonPressed: { opacity: opacity.subtle },
    buttonText: { ...typography.bodyStrong, textAlign: "center" },
    buttonTextPrimary: { color: theme.onAction },
    buttonTextSecondary: { color: theme.color },
    buttonTextQuiet: { color: theme.interactiveText },
    buttonTextDanger: { color: theme.danger },
    buttonTextDisabled: { color: theme.disabledText },
    iconButton: { alignItems: "center", borderRadius: radius.round, justifyContent: "center" },
    iconButtonSurface: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline },
    iconButtonSoft: { backgroundColor: theme.actionSoft },
    iconButtonPrimary: { backgroundColor: theme.actionBackground },
    dialogBackdrop: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing[4] },
    dialogCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], maxWidth: 520, padding: spacing[4], width: "100%", ...elevation.raised },
    dialogTitle: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    dialogDescription: { ...typography.body, color: theme.colorMuted, textAlign: "right" },
    dialogActions: { flexDirection: "row", gap: spacing[2], justifyContent: "flex-end" },
    dialogAction: { flex: 1 },
    chip: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.round, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[1], minHeight: sizing.controlSm, paddingHorizontal: spacing[3] },
    chipSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    chipDisabled: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    chipText: { ...typography.bodySm, color: theme.color, textAlign: "center" },
    chipTextSelected: { color: theme.interactiveText, fontWeight: "600" },
    chipTextDisabled: { color: theme.disabledText },
    navigationRow: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], minHeight: sizing.controlLg + spacing[4], paddingHorizontal: spacing[3], paddingVertical: spacing[3], width: "100%" },
    navigationRowCompact: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: sizing.controlLg, paddingHorizontal: spacing[2], paddingVertical: spacing[1], width: "100%" },
    navigationRowDisabled: { opacity: opacity.disabled },
    navigationRowIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
    navigationRowIconCompact: { height: sizing.controlSm, width: sizing.controlSm },
    navigationRowCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
    navigationRowTitle: { ...typography.bodyStrong, color: theme.color },
    navigationRowDescription: { ...typography.caption, color: theme.colorMuted },
    searchField: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: sizing.controlLg, paddingHorizontal: spacing[3] },
    searchInput: { ...typography.body, color: theme.color, flex: 1, minHeight: sizing.controlLg, paddingVertical: 0 },
    sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" },
    sectionHeaderText: { flex: 1, gap: spacing[1] },
    sectionTitle: { ...typography.titleSm, color: theme.color },
    sectionSubtitle: { ...typography.bodySm, color: theme.colorMuted },
    sectionAction: { minHeight: sizing.controlSm, justifyContent: "center", paddingHorizontal: spacing[2] },
    sectionActionText: { ...typography.bodySm, color: theme.interactiveText, textAlign: "center" },
    statusBadge: { alignItems: "center", borderRadius: radius.round, flexDirection: "row", gap: spacing[1], minHeight: sizing.controlSm, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    statusBadgeText: { ...typography.caption, textAlign: "center" },
    skeleton: { backgroundColor: theme.surfaceInset, borderRadius: radius.sm },
  });
}
