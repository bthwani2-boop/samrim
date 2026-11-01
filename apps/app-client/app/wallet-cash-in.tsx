import { useLocalSearchParams } from "expo-router";
import { clientWalletCashInAuthReturnPath } from "../src/features/access/client-auth-return-path";
import { ClientCashInPanel } from "../src/features/wallet/cash-in-panel";
import { ClientProtectedScreen } from "../src/shell/client-protected-screen";

export default function ClientWalletCashInRoute() {
  const params = useLocalSearchParams<{ amountMinor?: string; fromCheckout?: string }>();
  const requested = Number(params.amountMinor ?? "");
  const initialAmountMinor = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  return <ClientProtectedScreen authReturnPath={clientWalletCashInAuthReturnPath(params.amountMinor, params.fromCheckout)}><ClientCashInPanel mode="cash-in" initialAmountMinor={initialAmountMinor} returnToCheckout={params.fromCheckout === "1"} /></ClientProtectedScreen>;
}
