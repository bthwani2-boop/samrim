package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestMarketingBannerPresentationValidatesBeforeDatabaseMutation(t *testing.T) {
	tests := []struct {
		name, mode              string
		seconds, expected       int
		actor, correlation, key string
	}{
		{"unknown motion", "ROTATE", 5, 1, "operator", "corr", "idempotency"},
		{"too fast", "CINEMATIC", 2, 1, "operator", "corr", "idempotency"},
		{"too slow", "CROSSFADE", 11, 1, "operator", "corr", "idempotency"},
		{"missing version", "STATIC", 5, 0, "operator", "corr", "idempotency"},
		{"missing actor", "STATIC", 5, 1, "", "corr", "idempotency"},
		{"missing correlation", "STATIC", 5, 1, "operator", "", "idempotency"},
		{"missing idempotency", "STATIC", 5, 1, "operator", "corr", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, replayed, err := SetBannerPresentation(context.Background(), nil, tc.mode, tc.seconds, tc.expected, tc.actor, tc.correlation, tc.key)
			if replayed || !errors.Is(err, ErrBannerPresentationInvalid) {
				t.Fatalf("expected validation rejection before db access: replayed=%v err=%v", replayed, err)
			}
		})
	}
}

func TestMarketingBannerPresentationMigrationRegistered(t *testing.T) {
	records, sql, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != SchemaVersion || records[144].Name != "145_marketing_banner_presentation.sql" {
		t.Fatalf("missing marketing banner migration at v145: %+v", records[len(records)-1])
	}
	if len(sql) != SchemaVersion {
		t.Fatal("migration SQL count mismatch")
	}
}
