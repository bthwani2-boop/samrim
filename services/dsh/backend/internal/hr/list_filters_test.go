package hr

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestValidateListFilters(t *testing.T) {
	valid, err := validateListFilters(ListFilters{
		Query: " Ahmed ", Department: " Operations ", JobTitle: " Agent ",
		Status: "active", Linked: "unlinked", Limit: 25,
	})
	if err != nil || valid.Query != "Ahmed" || valid.Department != "Operations" || valid.JobTitle != "Agent" {
		t.Fatalf("expected normalized server-wide HR filters, got %+v / %v", valid, err)
	}
	tests := []ListFilters{
		{Limit: 0}, {Limit: 51}, {Limit: 25, Status: "unknown"},
		{Limit: 25, Linked: "both"}, {Limit: 25, Department: string(make([]byte, 81))},
	}
	for i, options := range tests {
		if _, err := validateListFilters(options); !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d: expected invalid filter, got %v", i, err)
		}
	}
}

func TestHRDirectoryCursorIsBoundToEveryServerFilter(t *testing.T) {
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	created := time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC)
	source := cursor{Query: "Ahmed", Department: "Operations", JobTitle: "Agent", Status: "active", Linked: "linked", CreatedAt: created, ID: "emp_1"}
	b, _ := json.Marshal(source)
	encoded := base64.RawURLEncoding.EncodeToString(b)
	filters := ListFilters{Query: source.Query, Department: source.Department, JobTitle: source.JobTitle, Status: source.Status, Linked: "unlinked", Cursor: encoded, Limit: 25}
	if _, err := List(context.Background(), db, filters); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cursor from a different filter must be refused before querying DB, got %v", err)
	}
}
