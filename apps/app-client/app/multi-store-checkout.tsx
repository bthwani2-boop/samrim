import MultiStoreCheckoutScreen from "../src/features/multi-store-checkout/multi-store-checkout";
import { ClientProtectedScreen } from "../src/shell/client-protected-screen";
export default function MultiStoreCheckoutRoute() { return <ClientProtectedScreen><MultiStoreCheckoutScreen /></ClientProtectedScreen>; }
