import { Text, View } from "react-native";
/** Deposits and reconciliation are owner-managed WLT operations. */
export default function CashInPanel() {
  return <View accessibilityLabel="توريد النقد غير متاح"><Text>توريد النقد يتطلب عملية WLT موثقة وقابلة للتسوية.</Text></View>;
}
