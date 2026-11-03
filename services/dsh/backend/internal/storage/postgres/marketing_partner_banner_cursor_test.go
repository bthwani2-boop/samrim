package postgres

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPartnerBannerCursorBindsStoreOrderAndCreatedTimestamp(t *testing.T) {
	item := DiscoveryContentRecord{
		ID: "banner-60", Ordinal: 3,
		CreatedAt: time.Date(2026, 11, 3, 16, 12, 13, 123456000, time.UTC),
	}
	encoded := encodePartnerBannerCursor("store-owner", item)
	got, err := decodePartnerBannerCursor("store-owner", encoded)
	if err != nil || got.StoreID != "store-owner" || got.ID != item.ID || got.Ordinal != item.Ordinal || !got.CreatedAt.Equal(item.CreatedAt) {
		t.Fatalf("valid keyset cursor did not round-trip: %+v err=%v", got, err)
	}
	for _, tc := range []struct{ store, cursor string }{
		{"store-other", encoded},
		{"store-owner", "%"},
		{"store-owner", strings.Repeat("a", 1025)},
	} {
		if _, err := decodePartnerBannerCursor(tc.store, tc.cursor); !errors.Is(err, ErrDiscoveryContentInvalid) {
			t.Fatalf("forged or foreign cursor accepted: store=%q err=%v", tc.store, err)
		}
	}
}
