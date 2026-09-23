package domain

import (
	"errors"
	"strings"
)

const (
	CurrencyYER          = "YER"
	MethodCashOnDelivery = "CASH_ON_DELIVERY"
	MethodCashAtStore    = "CASH_AT_STORE"
	StateRequiresCollect = "REQUIRES_COLLECTION"
	StateCollected       = "COLLECTED"
	StateCancelled       = "CANCELLED"
)

var (
	ErrInvalidInput    = errors.New("payment input is invalid")
	ErrStateConflict   = errors.New("payment intent state does not allow this operation")
	ErrAmountMismatch  = errors.New("collected amount does not match the payment intent")
	ErrVersionConflict = errors.New("payment intent version is stale")
)

func ValidateCreate(externalReference, payerActorID, currency, method string, amountMinor int64) error {
	if bounded(externalReference, 1, 128) == "" || bounded(payerActorID, 1, 128) == "" || amountMinor <= 0 {
		return ErrInvalidInput
	}
	if strings.TrimSpace(currency) != CurrencyYER || (strings.TrimSpace(method) != MethodCashOnDelivery && strings.TrimSpace(method) != MethodCashAtStore) {
		return ErrInvalidInput
	}
	return nil
}

func ValidateCollect(collectedByActorID, collectionReference string, collectedAmountMinor, expectedAmountMinor int64) error {
	if bounded(collectedByActorID, 1, 128) == "" || collectedAmountMinor <= 0 || expectedAmountMinor <= 0 {
		return ErrInvalidInput
	}
	if strings.TrimSpace(collectionReference) != "" && len(strings.TrimSpace(collectionReference)) > 128 {
		return ErrInvalidInput
	}
	if collectedAmountMinor != expectedAmountMinor {
		return ErrAmountMismatch
	}
	return nil
}

func ValidateCancel(reason string) error {
	if bounded(reason, 1, 256) == "" {
		return ErrInvalidInput
	}
	return nil
}

func CanCollect(state string) bool { return strings.TrimSpace(state) == StateRequiresCollect }

func CanCancel(state string) bool { return strings.TrimSpace(state) == StateRequiresCollect }

func bounded(value string, minimum, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) < minimum || len(value) > maximum {
		return ""
	}
	return value
}
