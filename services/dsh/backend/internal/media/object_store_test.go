package media

import (
	"errors"
	"testing"
)

func TestValidateObjectKeyRejectsTraversalAndUnscopedKeys(t *testing.T) {
	for _, key := range []string{"../secret", "catalog/products/../secret.jpg", "catalog/media/secret.jpg", "catalog/products/a\\b.jpg"} {
		if err := ValidateObjectKey(key); !errors.Is(err, ErrInvalidObjectKey) {
			t.Fatalf("ValidateObjectKey(%q) = %v", key, err)
		}
	}
}

func TestKeyForUploadIsDeterministicAndScoped(t *testing.T) {
	first, err := KeyForUpload("product_123", "idem-123", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	second, err := KeyForUpload("product_123", "idem-123", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "image/jpeg")
	if err != nil || first != second {
		t.Fatalf("key is not deterministic: first=%q second=%q err=%v", first, second, err)
	}
	if err := ValidateObjectKey(first); err != nil {
		t.Fatalf("generated key is invalid: %v", err)
	}
}
