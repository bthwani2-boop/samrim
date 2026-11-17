import { Text, View } from "react-native";
/** DSH-scoped only: no recipient contact data is exposed without a current assigned mission. */
export default function OrderConversation() {
  return <View accessibilityLabel="محادثة الطلب غير متاحة"><Text>محادثة الطلب تتطلب صلاحية المهمة الحالية وحماية بيانات المستلم.</Text></View>;
}
