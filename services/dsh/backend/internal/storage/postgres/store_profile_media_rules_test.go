package postgres

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
)

func TestCanUploadStoreProfileMediaByJoiningCaseState(t *testing.T) {
	cases := []struct {
		name    string
		state   string
		storeID string
		want    bool
	}{
		{name: "field draft", state: "draft", want: true},
		{name: "partner correction", state: "needs_correction", want: true},
		{name: "published owner profile", state: "approved", storeID: "store-1", want: true},
		{name: "approved without store", state: "approved", want: false},
		{name: "submitted", state: "submitted", storeID: "store-1", want: false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := CanUploadStoreProfileMedia(test.state, test.storeID); got != test.want {
				t.Fatalf("CanUploadStoreProfileMedia(%q, %q) = %t, want %t", test.state, test.storeID, got, test.want)
			}
		})
	}
}

func TestStoreProfileMediaUploadHashIncludesProvenance(t *testing.T) {
	provenance := media.Provenance{Creator: "Creator", SourceDescription: "Store supplied", RightsStatement: "Permission for display", RightsAttested: true}
	baseline := HashStoreProfileMediaUploadRequest("case-1", "sha", 2, provenance)
	changed := provenance
	changed.RightsStatement = "Permission revoked"
	if got := HashStoreProfileMediaUploadRequest("case-1", "sha", 2, changed); got == baseline {
		t.Fatal("changing the rights statement did not change the upload idempotency hash")
	}
	changed = provenance
	changed.Creator = "Another creator"
	if got := HashStoreProfileMediaUploadRequest("case-1", "sha", 2, changed); got == baseline {
		t.Fatal("changing the creator did not change the upload idempotency hash")
	}
}
