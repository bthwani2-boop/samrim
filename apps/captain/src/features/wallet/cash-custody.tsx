import { Text, View } from "react-native";
/** Cash custody is an attributed WLT ledger fact, not an editable client figure. */
export default function CashCustody() {
  return <View accessibilityLabel="عهدة النقد غير متاحة"><Text>عهدة الكابتن النقدية تستمد من WLT ولا تعدل محليًا.</Text></View>;
}
