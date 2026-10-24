package transporthttp

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPromotionRegistryFiltersRoundTripAcrossCursorPages(t *testing.T) {
	request := httptest.NewRequest("GET", "/dsh/operator/promotions?discountKind=FIXED&fundingSource=SHARED&state=PUBLISHED&sort=starts_asc&limit=25", nil)
	query, err := parseOperatorPromotionRegistryQuery(request)
	if err != nil {
		t.Fatalf("parse first page: %v", err)
	}
	if query.DiscountKind != "FIXED" || query.FundingSource != "SHARED" || query.Limit != 25 {
		t.Fatalf("filters not owned by registry query: %+v", query)
	}
	createdAt := time.Date(2026, 10, 23, 12, 30, 0, 0, time.UTC)
	cursor, err := encodeOperatorPromotionRegistryCursor(postgres.PromotionRecord{ID: "promotion-25", StartsAt: createdAt}, query)
	if err != nil {
		t.Fatal(err)
	}
	next := httptest.NewRequest("GET", "/dsh/operator/promotions?discountKind=FIXED&fundingSource=SHARED&state=PUBLISHED&sort=starts_asc&limit=25&cursor="+cursor, nil)
	paged, err := parseOperatorPromotionRegistryQuery(next)
	if err != nil || paged.AfterStartsAt == nil || paged.AfterID != "promotion-25" || !paged.AfterStartsAt.Equal(createdAt) {
		t.Fatalf("cursor page did not preserve filters and ordering: %+v error=%v", paged, err)
	}
	if paged.DiscountKind != "FIXED" || paged.FundingSource != "SHARED" {
		t.Fatalf("cursor changed filter scope: %+v", paged)
	}
	for _, invalidURL := range []string{
		"/dsh/operator/promotions?discountKind=PERCENTAGE&fundingSource=SHARED&state=PUBLISHED&sort=starts_asc&cursor=" + cursor,
		"/dsh/operator/promotions?discountKind=FIXED&fundingSource=PARTNER&state=PUBLISHED&sort=starts_asc&cursor=" + cursor,
		"/dsh/operator/promotions?discountKind=BOGUS",
		"/dsh/operator/promotions?fundingSource=UNKNOWN",
	} {
		if _, err := parseOperatorPromotionRegistryQuery(httptest.NewRequest("GET", invalidURL, nil)); err == nil {
			t.Fatalf("invalid filter or cursor accepted: %s", invalidURL)
		}
	}
}

func TestPromotionRegistryFilterIsOptionalForLegacyConsumers(t *testing.T) {
	query, err := parseOperatorPromotionRegistryQuery(httptest.NewRequest("GET", "/dsh/operator/promotions?limit=25", nil))
	if err != nil {
		t.Fatal(err)
	}
	if query.DiscountKind != "" || query.FundingSource != "" {
		t.Fatalf("omitted filters changed original registry behavior: %+v", query)
	}
}
