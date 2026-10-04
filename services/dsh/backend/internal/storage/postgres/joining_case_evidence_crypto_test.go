package postgres

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestJoiningCaseEvidenceKeyringRetainsPreviousReferencedKeys(t *testing.T) {
	key := func(fill byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32)) }
	keyring, err := NewJoiningCaseEvidenceKeyring("current", map[string]string{
		"current":  key(1),
		"previous": key(2),
	})
	if err != nil {
		t.Fatalf("create joining-case evidence keyring: %v", err)
	}
	if !keyring.HasKey("current") || !keyring.HasKey("previous") || keyring.HasKey("removed") {
		t.Fatal("joining-case evidence keyring does not report its configured IDs")
	}
}
