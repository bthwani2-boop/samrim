import { Text, View } from "react-native";
/** Membership approval/revocation belongs to DSH and requires Captain consent. */
export default function StoreMemberships() {
  return <View accessibilityLabel="عضويات المتاجر غير متاحة"><Text>عضويات المتاجر تتطلب قراءة DSH المصرح بها وموافقة الكابتن.</Text></View>;
}
