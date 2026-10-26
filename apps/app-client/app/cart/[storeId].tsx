import ClientCartScreen from "../../src/features/cart-checkout/client-cart-screen";
import { ClientProtectedScreen } from "../../src/shell/client-protected-screen";
export default function ClientCartRoute() { return <ClientProtectedScreen><ClientCartScreen /></ClientProtectedScreen>; }
