import { useLocalSearchParams } from "expo-router";
import { ClientCashInPanel } from "../../src/features/wallet/cash-in-panel";

export default function ClientWalletCashInRoute() {
  const params = useLocalSearchParams<{ amountMinor?: string; fromCheckout?: string }>();
  const requested = Number(params.amountMinor ?? "");
  const initialAmountMinor = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  return <ClientCashInPanel mode="cash-in" initialAmountMinor={initialAmountMinor} returnToCheckout={params.fromCheckout === "1"} />;
}
