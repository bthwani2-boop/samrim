package postgres

import (
	"errors"
	"strings"
)

const (
	FulfillmentModeBthwaniCaptain = "BTHWANI_CAPTAIN"
	FulfillmentModePartnerCaptain = "PARTNER_CAPTAIN"
	FulfillmentModeCustomerPickup = "CUSTOMER_PICKUP"
)

var ErrFulfillmentModesInvalid = errors.New("Store fulfillment modes are invalid")

func NormalizeStoreFulfillmentModes(values []string) ([]string, error) {
	if len(values) == 0 {
		return []string{FulfillmentModeBthwaniCaptain}, nil
	}
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		mode := strings.ToUpper(strings.TrimSpace(value))
		if mode != FulfillmentModeBthwaniCaptain && mode != FulfillmentModeCustomerPickup || seen[mode] {
			return nil, ErrFulfillmentModesInvalid
		}
		seen[mode] = true
	}
	result := make([]string, 0, len(seen))
	if seen[FulfillmentModeBthwaniCaptain] {
		result = append(result, FulfillmentModeBthwaniCaptain)
	}
	if seen[FulfillmentModeCustomerPickup] {
		result = append(result, FulfillmentModeCustomerPickup)
	}
	if len(result) == 0 {
		return nil, ErrFulfillmentModesInvalid
	}
	return result, nil
}
