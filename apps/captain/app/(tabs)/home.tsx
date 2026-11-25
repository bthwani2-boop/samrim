import CaptainHomeScreen from "../../src/features/dispatch/captain-home-screen";
import CaptainDeviceLocationReadiness from "../../src/features/location/device-location-readiness";

export default function CaptainHomeRoute() {
  return <CaptainHomeScreen><CaptainDeviceLocationReadiness /></CaptainHomeScreen>;
}
