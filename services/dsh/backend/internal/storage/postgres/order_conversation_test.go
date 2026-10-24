package postgres

import (
	"errors"
	"testing"
	"time"
)

func TestOrderConversationClosesAtOperationalCompletion(t *testing.T) {
	updatedAt := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	for _, state := range []string{"DELIVERED", "PICKED_UP", "REJECTED", "CANCELLED"} {
		t.Run(state, func(t *testing.T) {
			order := orderConversationOrder{State: state, UpdatedAt: updatedAt}
			readOnlyAt := order.ReadOnlyAt()
			if readOnlyAt == nil || !readOnlyAt.Equal(updatedAt) {
				t.Fatalf("ReadOnlyAt() = %v, want immediate closure on completion", readOnlyAt)
			}
		})
	}

	for _, state := range []string{"CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "IN_CUSTODY", "DELIVERY_FAILED"} {
		t.Run(state, func(t *testing.T) {
			order := orderConversationOrder{State: state, UpdatedAt: updatedAt}
			if readOnlyAt := order.ReadOnlyAt(); readOnlyAt != nil {
				t.Fatalf("ReadOnlyAt() = %v for nonterminal state %q, want nil", readOnlyAt, state)
			}
		})
	}
}

func TestOrderConversationAudienceHashAndValidation(t *testing.T) {
	orderID, body := "order-a", "رسالة"
	public := HashOrderConversationMessageRequest(orderID, body)
	private := HashOrderConversationMessageRequest(orderID, body, "operator")
	if public == private {
		t.Fatal("a change in audience must change idempotency facts")
	}
	if HashOrderConversationMessageRequest(orderID, body, "partner", "operator") !=
		HashOrderConversationMessageRequest(orderID, body, "operator", "partner") {
		t.Fatal("audience order must not affect the idempotency hash")
	}
	for _, invalid := range [][]string{{"unknown"}, {"operator", "operator"}, {"client", "partner", "captain", "operator", "client"}} {
		if _, err := normalizeConversationRecipients(invalid); !errors.Is(err, ErrOrderConversationInvalid) {
			t.Fatalf("invalid roles %v not rejected: %v", invalid, err)
		}
	}
	defaultAudience, err := normalizeConversationRecipients(nil)
	if err != nil || len(defaultAudience) != 3 || hasConversationRecipient(defaultAudience, "operator") {
		t.Fatalf("legacy audience changed: %v %v", defaultAudience, err)
	}
	roles, err := normalizeConversationRecipients([]string{"operator", "partner"})
	if err != nil || len(roles) != 2 || roles[0] != "operator" || roles[1] != "partner" {
		t.Fatalf("targeted audience invalid: %v %v", roles, err)
	}
}

func TestOrderConversationMediaValidationAndBoundedIdempotency(t *testing.T) {
	png := OrderConversationMedia{Kind: "image", ContentType: "image/png", Bytes: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01}}
	if err := ValidateOrderConversationMedia(png); err != nil {
		t.Fatal(err)
	}
	fake := png
	fake.ContentType = "image/jpeg"
	if err := ValidateOrderConversationMedia(fake); !errors.Is(err, ErrOrderConversationInvalid) {
		t.Fatalf("spoof accepted: %v", err)
	}
	tooLarge := png
	tooLarge.Bytes = make([]byte, 3*1024*1024+1)
	if err := ValidateOrderConversationMedia(tooLarge); !errors.Is(err, ErrOrderConversationInvalid) {
		t.Fatalf("oversized media accepted: %v", err)
	}
	aac := OrderConversationMedia{Kind: "audio", ContentType: "audio/aac", Bytes: []byte{0xff, 0xf1, 0x50, 0x80, 0x10, 0x00, 0x00, 0, 0, 0, 0, 0}}
	if err := ValidateOrderConversationMedia(aac); err != nil {
		t.Fatalf("AAC rejected: %v", err)
	}
	video := OrderConversationMedia{Kind: "video", ContentType: "video/mp4", Bytes: append([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, make([]byte, 40)...)}
	if err := ValidateOrderConversationMedia(video); err != nil {
		t.Fatalf("valid MP4 video rejected: %v", err)
	}
	spoofedVideo := video
	spoofedVideo.ContentType = "video/webm"
	if err := ValidateOrderConversationMedia(spoofedVideo); !errors.Is(err, ErrOrderConversationInvalid) {
		t.Fatalf("spoofed video accepted: %v", err)
	}
	largeVideo := video
	largeVideo.Bytes = make([]byte, 6*1024*1024+1)
	if err := ValidateOrderConversationMedia(largeVideo); !errors.Is(err, ErrOrderConversationInvalid) {
		t.Fatalf("oversized video accepted: %v", err)
	}
	if HashOrderConversationMediaRequest("order", "صورة", []string{"partner"}, png) == HashOrderConversationMediaRequest("order", "صورة", []string{"operator"}, png) {
		t.Fatal("audience not bound to media hash")
	}
	if HashOrderConversationMediaRequest("order", "صورة", []string{"partner"}, png) == HashOrderConversationMessageRequest("order", "صورة", "partner") {
		t.Fatal("media and text requests use same hash")
	}
}
