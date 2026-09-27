package transporthttp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPublicPromotionProjectionOmitsOperatorAndEligibilityInternals(t *testing.T) {
	endsAt := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	payload, err := json.Marshal(toPublicPromotionView(postgres.PromotionRecord{
		ID: "promotion-public-1", Code: "SAVE10", NameAr: "خصم للعملاء", DescriptionAr: "وصف العرض",
		Kind: "PERCENTAGE", ValueMinor: 10, FundingSource: "MERCHANT", StoreID: "store-private-1",
		ServiceCityID: "city-private-1", State: "PUBLISHED", StartsAt: endsAt.Add(-time.Hour), EndsAt: &endsAt,
		RedemptionLimit: int64Pointer(50), RedeemedCount: 3, Version: 7, CreatedByActorID: "operator-private-1",
		CreatedAt: endsAt.Add(-2 * time.Hour), UpdatedAt: endsAt.Add(-time.Hour),
	}))
	if err != nil {
		t.Fatalf("marshal public promotion projection: %v", err)
	}
	serialized := string(payload)
	for _, forbidden := range []string{"fundingSource", "storeId", "serviceCityId", "state", "startsAt", "redemptionLimit", "redeemedCount", "version", "createdByActorId", "createdAt", "updatedAt", "operator-private-1", "store-private-1", "city-private-1"} {
		if strings.Contains(serialized, forbidden) {
			t.Errorf("public promotion payload exposes %q: %s", forbidden, serialized)
		}
	}
	for _, required := range []string{"promotion-public-1", "SAVE10", "خصم للعملاء", "وصف العرض", "endsAt"} {
		if !strings.Contains(serialized, required) {
			t.Errorf("public promotion payload omits %q: %s", required, serialized)
		}
	}
}

func TestPublicDiscoveryContentProjectionOmitsOperatorAndPublicationInternals(t *testing.T) {
	payload, err := json.Marshal(toPublicDiscoveryContentView(postgres.DiscoveryContentRecord{
		ID: "content-public-1", Kind: "BANNER", TitleAr: "متجر مميز", BodyAr: "اكتشف المنتجات",
		MediaURI: "https://media.test/banner.webp", TargetType: "STORE", TargetID: "store-public-1",
		ServiceCityID: "city-private-1", State: "PUBLISHED", StartsAt: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
		Ordinal: 2, Version: 7, CreatedByActorID: "operator-private-1", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}))
	if err != nil {
		t.Fatalf("marshal public discovery-content projection: %v", err)
	}
	serialized := string(payload)
	for _, forbidden := range []string{"serviceCityId", "state", "startsAt", "ordinal", "version", "createdByActorId", "createdAt", "updatedAt", "operator-private-1", "city-private-1"} {
		if strings.Contains(serialized, forbidden) {
			t.Errorf("public discovery-content payload exposes %q: %s", forbidden, serialized)
		}
	}
	for _, required := range []string{"content-public-1", "BANNER", "متجر مميز", "اكتشف المنتجات", "https://media.test/banner.webp", "STORE", "store-public-1"} {
		if !strings.Contains(serialized, required) {
			t.Errorf("public discovery-content payload omits %q: %s", required, serialized)
		}
	}
}

func int64Pointer(value int64) *int64 { return &value }
