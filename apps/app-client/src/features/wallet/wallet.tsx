import { type Href, useRouter } from "expo-router";
import { ClientScrollScreen } from "../../shell/client-shell";
import { ClientCashInPanel } from "./cash-in-panel";

export default function ClientWallet() {
  const router = useRouter();
  return (
    <ClientScrollScreen>
      <ClientCashInPanel mode="wallet" onAddFunds={() => router.push("/wallet-cash-in" as Href)} />
    </ClientScrollScreen>
  );
}
