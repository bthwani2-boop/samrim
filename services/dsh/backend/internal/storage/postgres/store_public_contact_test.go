package postgres

import (
	"errors"
	"testing"
)

func TestValidateStorePublicContactInput(t *testing.T) {
	valid := StorePublicContactInput{
		PhoneE164: " +967712345678 ", Email: " store@example.com ",
		WhatsAppPhoneE164: "+967734567890", WhatsAppEnabled: true,
		ExpectedVersion: 0,
	}
	out, err := ValidateStorePublicContactInput(valid)
	if err != nil { t.Fatal(err) }
	if out.PhoneE164 != "+967712345678" || out.Email != "store@example.com" || out.WhatsAppPhoneE164 != "+967734567890" {
		t.Fatalf("canonical contact values not trimmed: %+v", out)
	}
	tests := map[string]StorePublicContactInput{
		"public owner phone must never be inferred": { WhatsAppEnabled: true, ExpectedVersion: 0 },
		"malformed phone": { PhoneE164: "712345678" },
		"ambiguous phone": { PhoneE164: "+00002345" },
		"whatsapp without number": { WhatsAppEnabled: true },
		"display name email": { Email: "Example <store@example.com>" },
		"email with newline": { Email: "store@example.com\r\nBcc:x@example.com" },
		"negative expected version": { ExpectedVersion: -1 },
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := ValidateStorePublicContactInput(input); !errors.Is(err, ErrStorePublicContactInput) {
				t.Fatalf("expected validation rejection, got %v", err)
			}
		})
	}
	if _, err := ValidateStorePublicContactInput(StorePublicContactInput{}); err != nil {
		t.Fatalf("clearing intentionally public contact must be legal: %v", err)
	}
}
