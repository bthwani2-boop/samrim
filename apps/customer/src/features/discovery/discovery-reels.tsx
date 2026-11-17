import { Text, View } from "react-native";

export type DiscoveryReelsItem = Readonly<{ id: string; label: string }>;
/** Renders only explicitly supplied, authorized presentation data. */
export default function DiscoveryReels({ items = [] }: Readonly<{ items?: readonly DiscoveryReelsItem[] }>) {
  if (items.length === 0) return null;
  return <View>{items.map((item) => <Text key={item.id}>{item.label}</Text>)}</View>;
}
