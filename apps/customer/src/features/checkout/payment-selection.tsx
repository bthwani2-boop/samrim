import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Text } from "react-native";

/** Read-only display; no owner state is fabricated when no value is supplied. */
export default function PaymentSelection({ label }: Readonly<{ label?: string }>) {
  const { theme } = useMobileAppearance();
  return label ? <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>{label}</Text> : null;
}
