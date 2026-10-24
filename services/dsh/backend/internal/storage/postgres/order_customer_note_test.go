package postgres

import (
	"errors"
	"strings"
	"testing"
)

func TestOrderCustomerNoteMigrationRegistered(t *testing.T) {
	records, _, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != SchemaVersion || records[143].Name != "144_order_customer_notes.sql" {
		t.Fatalf("unexpected final migration: %+v", records[len(records)-1])
	}
}

func TestNormalizeCustomerOrderNote(t *testing.T) {
	note, err := NormalizeCustomerOrderNote("  بدون بصل  ")
	if err != nil || note != "بدون بصل" {
		t.Fatalf("unexpected normalized note %q err %v", note, err)
	}
	if _, err := NormalizeCustomerOrderNote(strings.Repeat("س", 501)); !errors.Is(err, ErrCheckoutCustomerNoteInvalid) {
		t.Fatalf("expected length validation, got %v", err)
	}
	if _, err := NormalizeCustomerOrderNote("abc\x00secret"); !errors.Is(err, ErrCheckoutCustomerNoteInvalid) {
		t.Fatalf("expected control character rejection, got %v", err)
	}
}

func TestCheckoutIdempotencyHashBindsCustomerNoteWithoutChangingLegacy(t *testing.T) {
	base := CheckoutInput{ClientActorID: "client", StoreID: "store", CartID: "cart", AddressID: "addr", FulfillmentMode: FulfillmentModeBthwaniCaptain, PaymentMethod: "CASH_ON_DELIVERY"}
	oldHash := HashCheckoutRequest(base)
	withNote := base
	withNote.CustomerNote = "بدون بصل"
	if HashCheckoutRequest(withNote) == oldHash {
		t.Fatal("changing note must change idempotency request hash")
	}
	withOtherNote := base
	withOtherNote.CustomerNote = "بدون ثوم"
	if HashCheckoutRequest(withOtherNote) == HashCheckoutRequest(withNote) {
		t.Fatal("distinct notes must have different request hashes")
	}
	if HashCheckoutRequest(base) != oldHash {
		t.Fatal("note-free requests must preserve legacy hash")
	}
}
