package actor

import (
    "context"
    "testing"
)

func TestResolveClientShareRecipientRejectsUnauthorizedAndInvalidPhone(t *testing.T) {
    service := &Service{}
    for _, item := range []struct{caller, phone string}{
        {"control-panel", "+967777123456"},
        {"", "+967777123456"},
        {"dsh", "777"},
        {"dsh", "+967777123456' OR true --"},
    } {
        if _, err := service.ResolveClientShareRecipient(context.Background(), item.caller, item.phone); err == nil {
            t.Errorf("accepted caller %q phone %q", item.caller, item.phone)
        }
    }
}
