import { CaptainOffers } from "../src/features/captain-operations/captain-offers";
import { CaptainScrollScreen } from "../src/shell/captain-shell";
import { CaptainProtectedScreen } from "../src/shell/captain-protected-screen";
export default function CaptainOffersRoute() { return <CaptainProtectedScreen><CaptainScrollScreen><CaptainOffers /></CaptainScrollScreen></CaptainProtectedScreen>; }
