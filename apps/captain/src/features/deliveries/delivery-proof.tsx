import { Text, View } from "react-native";
/** An offline/local proof cannot mark an order delivered or debit WLT. */
export default function DeliveryProof() {
  return <View accessibilityLabel="إثبات التسليم غير متاح"><Text>إثبات التسليم يجب أن يعتمد من DSH قبل تأكيد إكمال الطلب.</Text></View>;
}
