import { Host, Switch as UniversalSwitch } from "@expo/ui";

import { useMobileAppearance } from "./appearance";

/**
 * Controlled Expo UI switch with the app's native color scheme.
 * Callers still own persistence, validation and permission decisions.
 */
export function BthwaniUiSwitch({
  value,
  disabled = false,
  onValueChange,
  label,
  testID,
}: {
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  testID?: string;
}) {
  const { themeName, theme } = useMobileAppearance();
  return (
    <Host accessibilityLabel={label} matchContents colorScheme={themeName} seedColor={theme.brandAction}>
      <UniversalSwitch
        disabled={disabled}
        label={label}
        onValueChange={onValueChange}
        {...(testID ? { testID } : {})}
        value={value}
      />
    </Host>
  );
}
