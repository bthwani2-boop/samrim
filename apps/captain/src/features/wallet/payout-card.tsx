import { Text, View } from "react-native";
/** Do not derive payouts from order totals or from a local cache. */
export default function PayoutCard() {
  return <View accessibilityLabel="المستحقات غير متاحة"><Text>المستحقات تعرض بعد تأكيد دفتر WLT فقط.</Text></View>;
}
