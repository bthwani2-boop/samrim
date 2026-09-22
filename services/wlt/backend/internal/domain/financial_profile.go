package domain

import (
	"errors"
	"strings"
)

const (
	OriginField        = "field"
	OriginControlPanel = "control_panel"

	SettlementDaily   = "DAILY"
	SettlementWeekly  = "WEEKLY"
	SettlementMonthly = "MONTHLY"

	ProfilePendingBinding = "PENDING_BINDING"
	ProfileActive         = "ACTIVE"
)

var (
	ErrFinancialProfileInvalidInput = errors.New("financial profile input is invalid")
	ErrFinancialProfileState        = errors.New("financial profile state does not allow this operation")
)

func ValidateFinancialProfile(joiningCaseID, partnerActorID, origin, settlementPeriod string, commissionRateBps int) error {
	if bounded(joiningCaseID, 1, 128) == "" || bounded(partnerActorID, 1, 128) == "" {
		return ErrFinancialProfileInvalidInput
	}
	if origin != OriginField && origin != OriginControlPanel {
		return ErrFinancialProfileInvalidInput
	}
	if commissionRateBps < 0 || commissionRateBps > 10000 {
		return ErrFinancialProfileInvalidInput
	}
	switch strings.TrimSpace(settlementPeriod) {
	case SettlementDaily, SettlementWeekly, SettlementMonthly:
		return nil
	default:
		return ErrFinancialProfileInvalidInput
	}
}

func CanActivateFinancialProfile(state string) bool {
	return strings.TrimSpace(state) == ProfilePendingBinding
}
