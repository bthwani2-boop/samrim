package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
)

func TestFieldFinanceRosterValidatesBoundedFiltersAndCursor(t *testing.T) {
	for _, test := range []struct {
		name           string
		query          string
		admissionState string
		cursor         string
		limit          int
	}{
		{name: "invalid state", admissionState: "pending", limit: 10},
		{name: "oversized search", query: string(make([]byte, 101)), admissionState: "all", limit: 10},
		{name: "oversized page", admissionState: "all", limit: 51},
		{name: "oversized cursor", admissionState: "all", cursor: string(make([]byte, 513)), limit: 10},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := ListFieldFinanceRoster(context.Background(), nil, test.query, test.admissionState, test.cursor, test.limit); !errors.Is(err, ErrFieldAdmissionRegistry) {
				t.Fatalf("got %v, want ErrFieldAdmissionRegistry", err)
			}
		})
	}
}

func TestFieldFinanceRosterCursorIsBoundToSearchAndAdmissionState(t *testing.T) {
	cursor := fieldFinanceRosterCursor{Version: 1, Query: "ali", State: "eligible", CreatedAt: "2026-10-08T00:00:00Z", AdmissionID: "admission-1"}
	encoded, err := json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	raw := base64.RawURLEncoding.EncodeToString(encoded)
	if _, err := decodeFieldFinanceRosterCursor(raw, "ali", "eligible"); err != nil {
		t.Fatalf("valid cursor rejected: %v", err)
	}
	if _, err := decodeFieldFinanceRosterCursor(raw, "other", "eligible"); !errors.Is(err, ErrFieldAdmissionRegistry) {
		t.Fatalf("cursor accepted under another search: %v", err)
	}
	if _, err := decodeFieldFinanceRosterCursor(raw, "ali", "suspended"); !errors.Is(err, ErrFieldAdmissionRegistry) {
		t.Fatalf("cursor accepted under another admission state: %v", err)
	}
}
