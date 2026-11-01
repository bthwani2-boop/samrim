package postgres_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStudioLayoutPublicationValidationAndSafety(t *testing.T) {
	good := studioFixture(t)
	if validated, err := postgres.ValidateStudioPublishedLayout(good); err != nil || len(validated) == 0 {
		t.Fatalf("published layout requires fully validated draft: %v", err)
	}
	for _, blocked := range []string{"topSellers", "testimonials"} {
		var doc map[string]any
		if err := json.Unmarshal(good, &doc); err != nil {
			t.Fatal(err)
		}
		for _, value := range doc["sections"].([]any) {
			section := value.(map[string]any)
			if section["id"] == blocked {
				section["visible"] = true
			}
		}
		raw, _ := json.Marshal(doc)
		if _, err := postgres.ValidateStudioPublishedLayout(raw); !errors.Is(err, postgres.ErrStudioLayoutInvalid) {
			t.Fatalf("unbacked section %s must not be published: %v", blocked, err)
		}
		if _, err := postgres.ValidateStudioDocument(raw); err != nil {
			t.Fatalf("unpublished draft may still display mock preview for %s: %v", blocked, err)
		}
	}
	for _, bad := range []json.RawMessage{json.RawMessage("null"), json.RawMessage("{}")} {
		if _, err := postgres.ValidateStudioPublishedLayout(bad); !errors.Is(err, postgres.ErrStudioLayoutInvalid) {
			t.Fatalf("unsupported document must fail: %v", err)
		}
	}
	cases := []struct {
		action   string
		expected int
		draft    int
		target   int
	}{
		{"ACTIVATE_DRAFT", 0, 2, 0},
		{"ACTIVATE_DRAFT", 1, 0, 0},
		{"ACTIVATE_DRAFT", 1, 2, 1},
		{"RESTORE_DEFAULTS", 1, 2, 0},
		{"ROLLBACK", 1, 0, 1},
		{"ROLLBACK", 2, 0, 2},
		{"ROLLBACK", 2, 0, 0},
		{"UNRECOGNIZED", 1, 0, 0},
	}
	for _, tc := range cases {
		if _, replayed, err := postgres.SetStudioLayoutPublication(
			context.Background(), nil, tc.action, tc.expected, tc.draft, tc.target,
			"marketing-actor", "studio-layout-test-corr", "studio-layout-test-key",
		); !errors.Is(err, postgres.ErrStudioLayoutInvalid) || replayed {
			t.Fatalf("bad %s/%d/%d/%d must fail before SQL; replay=%v err=%v",
				tc.action, tc.expected, tc.draft, tc.target, replayed, err)
		}
	}
}
