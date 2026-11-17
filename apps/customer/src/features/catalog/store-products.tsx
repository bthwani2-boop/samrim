import type { PublicOffer } from "@bthwani/dsh";
import ProductDetail from "./product-detail";

export default function StoreProducts({ offers }: Readonly<{ offers: readonly PublicOffer[] }>) {
  return <>{offers.map((offer) => <ProductDetail key={offer.id} offer={offer} />)}</>;
}
