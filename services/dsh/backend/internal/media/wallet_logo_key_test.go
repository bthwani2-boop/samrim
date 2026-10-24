package media

import (
	"strings"
	"testing"
)

func TestWalletProviderLogoKeyIsImmutableAndAllowed(t *testing.T) {
	sha := strings.Repeat("a", 64)
	a, e := KeyForWalletProviderLogo("wallet_provider_floosak", "upload-1", sha, "image/png")
	if e != nil || ValidateObjectKey(a) != nil {
		t.Fatalf("valid wallet provider logo key rejected: %s, %v", a, e)
	}
	b, e := KeyForWalletProviderLogo("wallet_provider_floosak", "upload-2", sha, "image/png")
	if e != nil || a == b {
		t.Fatal("distinct uploads must use distinct immutable keys")
	}
	if !strings.HasSuffix(a, ".png") {
		t.Fatal("PNG logo did not keep PNG extension")
	}
	if _, e = KeyForWalletProviderLogo("../evil", "upload-1", sha, "image/png"); e == nil {
		t.Fatal("invalid provider key accepted")
	}
	if _, e = KeyForWalletProviderLogo("wallet_provider_floosak", "upload-1", sha, "image/gif"); e == nil {
		t.Fatal("unsupported image type accepted")
	}
}
