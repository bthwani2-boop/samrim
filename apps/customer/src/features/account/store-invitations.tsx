import { Text, View } from "react-native";

export type StoreInvitationsItem = Readonly<{ id: string; label: string }>;
/** Renders only explicitly supplied, authorized presentation data. */
export default function StoreInvitations({ items = [] }: Readonly<{ items?: readonly StoreInvitationsItem[] }>) {
  if (items.length === 0) return null;
  return <View>{items.map((item) => <Text key={item.id}>{item.label}</Text>)}</View>;
}
