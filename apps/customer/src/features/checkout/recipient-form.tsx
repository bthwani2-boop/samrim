import { Text } from "react-native";

/** Read-only display; no owner state is fabricated when no value is supplied. */
export default function RecipientForm({ label }: Readonly<{ label?: string }>) {
  return label ? <Text>{label}</Text> : null;
}
