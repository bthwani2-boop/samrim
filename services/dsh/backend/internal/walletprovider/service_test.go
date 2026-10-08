package walletprovider

import (
	"regexp"
	"testing"
)

func TestProviderKeyForIdempotencyIsStableAndValid(t *testing.T) {
	first := providerKeyForIdempotency("create-attempt-1")
	if first != providerKeyForIdempotency(" create-attempt-1 ") {
		t.Fatal("same idempotency key did not produce the same provider key")
	}
	if first == providerKeyForIdempotency("create-attempt-2") {
		t.Fatal("different idempotency keys produced the same provider key")
	}
	if !regexp.MustCompile(`^wallet_provider_[a-f0-9]{32}$`).MatchString(first) {
		t.Fatalf("generated provider key has invalid format: %q", first)
	}
}
