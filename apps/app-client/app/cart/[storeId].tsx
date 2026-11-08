import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { clientStorefrontCartScope } from "../../src/features/access/client-auth-return-path";
import ClientCartScreen from "../../src/features/cart-checkout/client-cart-screen";
import { ClientProtectedScreen } from "../../src/shell/client-protected-screen";

export default function ClientCartRoute() {
  const { storeId, source, serviceCityId, productId } = useLocalSearchParams<{
    storeId?: string | string[]; source?: string | string[]; serviceCityId?: string | string[]; productId?: string | string[];
  }>();
  const storefront = Platform.OS === "web" && typeof storeId === "string"
    ? clientStorefrontCartScope(storeId, source, serviceCityId, productId)
    : null;
  return <ClientProtectedScreen {...(storefront ? { authReturnPath: storefront.returnPath } : {})}>
    <ClientCartScreen storefront={storefront} />
  </ClientProtectedScreen>;
}
