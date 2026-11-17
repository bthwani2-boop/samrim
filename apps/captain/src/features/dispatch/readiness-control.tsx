import {Text,View} from "react-native";
/** A local toggle cannot make a Captain ready in DSH. */
export default function ReadinessControl(){
  return <View accessibilityLabel="الجاهزية غير متاحة"><Text>تغيير الجاهزية غير متاح حتى ربط حالة الكابتن الموثقة في DSH.</Text></View>;
}
