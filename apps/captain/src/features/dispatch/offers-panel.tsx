import {Text,View} from "react-native";
/** No owner feed does not imply there are zero offers. */
export default function OffersPanel(){
  return <View accessibilityLabel="عروض التوصيل غير متاحة"><Text>عروض التوصيل تتطلب هوية كابتن وعروض DSH مصرحًا بها.</Text></View>;
}
