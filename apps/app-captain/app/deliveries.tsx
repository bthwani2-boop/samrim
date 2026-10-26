import { CaptainDeliveries } from "../src/features/captain-operations/captain-deliveries";
import { CaptainScrollScreen } from "../src/shell/captain-shell";
import { CaptainProtectedScreen } from "../src/shell/captain-protected-screen";
export default function CaptainDeliveriesRoute() { return <CaptainProtectedScreen><CaptainScrollScreen><CaptainDeliveries /></CaptainScrollScreen></CaptainProtectedScreen>; }
