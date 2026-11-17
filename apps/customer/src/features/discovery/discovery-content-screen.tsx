import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";
import DiscoveryReels from "./discovery-reels";
import HeroBanner from "./hero-banner";
import PromotionsFeed from "./promotions-feed";

export default function DiscoveryContentScreen() {
  return <><HeroBanner /><PromotionsFeed /><DiscoveryReels /><CapabilityUnavailableScreen title="المحتوى الترويجي" message="وجهة الفيديو أو العرض يجب أن تتحقق من صلاحية النشر والربط بالمتجر أو المنتج لدى DSH."  /></>;
}
