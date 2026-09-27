package media

import (
	"errors"
	"strings"
	"testing"
)

func TestProvenanceRequiresCreatorSourceRightsAndAttestation(t *testing.T) {
	valid := Provenance{
		Creator:           "Store owner",
		SourceDescription: "Original image supplied by the store owner",
		SourceURI:         "HTTPS://example.test/source",
		RightsStatement:   "The store owner confirms permission to display this image on BThwani",
		RightsURI:         "https://example.test/terms",
		RightsAttested:    true,
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid provenance rejected: %v", err)
	}
	if normalized := valid.Normalized(); normalized.SourceURI != "https://example.test/source" {
		t.Fatalf("source URI scheme was not normalized: %q", normalized.SourceURI)
	}

	invalid := []Provenance{
		{},
		{Creator: valid.Creator, SourceDescription: valid.SourceDescription, RightsStatement: valid.RightsStatement},
		{Creator: valid.Creator, SourceDescription: valid.SourceDescription, RightsStatement: valid.RightsStatement, RightsAttested: true, SourceURI: "file:///secret"},
		{Creator: valid.Creator, SourceDescription: valid.SourceDescription, RightsStatement: valid.RightsStatement, RightsAttested: true, RightsURI: "https://user:password@example.test/terms"},
		{Creator: valid.Creator, SourceDescription: valid.SourceDescription, RightsStatement: valid.RightsStatement, RightsAttested: true, SourceURI: "https://example.test/" + strings.Repeat("x", 2048)},
		{Creator: string([]byte{0xff}), SourceDescription: valid.SourceDescription, RightsStatement: valid.RightsStatement, RightsAttested: true},
	}
	for _, value := range invalid {
		if err := value.Validate(); !errors.Is(err, ErrInvalidProvenance) {
			t.Fatalf("invalid provenance accepted: %+v err=%v", value, err)
		}
	}
}
