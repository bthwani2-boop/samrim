package transporthttp

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func TestLegacyWalletProviderIntentRequiresMatchingStaleDestination(t *testing.T) {
	valid := wlt.OfficialWalletDestination{
		ID: "destination-legacy", ActorType: "field", ActorID: "field-actor",
		ProviderKey: " provider-jib ", VerificationStatus: "STALE", Status: "SUSPENDED",
	}
	intent, ok := legacyWalletProviderIntentFromStaleDestination("field", "field-actor", valid)
	if !ok || intent.ProviderKey != "provider-jib" || intent.SourceID != "legacy_official_wallet_destination:destination-legacy" {
		t.Fatalf("legacy stale destination intent = %+v, %t; want the normalized historical provider and explicit provenance", intent, ok)
	}

	for _, test := range []struct {
		name        string
		actorType   string
		actorID     string
		destination wlt.OfficialWalletDestination
	}{
		{name: "wrong actor", actorType: "field", actorID: "field-other", destination: valid},
		{name: "wrong role", actorType: "captain", actorID: "field-actor", destination: valid},
		{name: "active destination is not a migration fallback", actorType: "field", actorID: "field-actor", destination: func() wlt.OfficialWalletDestination {
			item := valid
			item.VerificationStatus = "VERIFIED"
			item.Status = "ACTIVE_FOR_PAYOUT"
			return item
		}()},
		{name: "suspended but not identity-stale", actorType: "field", actorID: "field-actor", destination: func() wlt.OfficialWalletDestination { item := valid; item.VerificationStatus = "VERIFIED"; return item }()},
		{name: "missing provider", actorType: "field", actorID: "field-actor", destination: func() wlt.OfficialWalletDestination { item := valid; item.ProviderKey = " "; return item }()},
	} {
		t.Run(test.name, func(t *testing.T) {
			if intent, ok := legacyWalletProviderIntentFromStaleDestination(test.actorType, test.actorID, test.destination); ok || intent.ProviderKey != "" {
				t.Fatalf("legacy intent unexpectedly accepted: %+v, %t", intent, ok)
			}
		})
	}
}

func TestCanonicalOfficialWalletPhoneRequiresActiveVerifiedIdentityRole(t *testing.T) {
	activatedAt := time.Date(2026, time.October, 4, 12, 0, 0, 0, time.UTC)
	validRole := identityclient.ActorRoleView{
		ActorID:         "actor_partner_1",
		PhoneE164:       "+967771234567",
		Role:            identityclient.ActorType("partner"),
		Enabled:         true,
		ActivatedAt:     &activatedAt,
		SecurityEnabled: true,
		ActorVersion:    7,
		RoleVersion:     5,
	}

	if phone, ok := canonicalOfficialWalletPhone("partner", "actor_partner_1", validRole); !ok || phone != validRole.PhoneE164 {
		t.Fatalf("canonicalOfficialWalletPhone(valid role)=(%q,%t), want (%q,true)", phone, ok, validRole.PhoneE164)
	}

	tests := []struct {
		name string
		role identityclient.ActorRoleView
	}{
		{name: "wrong actor", role: func() identityclient.ActorRoleView { role := validRole; role.ActorID = "actor_other"; return role }()},
		{name: "wrong role", role: func() identityclient.ActorRoleView {
			role := validRole
			role.Role = identityclient.ActorType("captain")
			return role
		}()},
		{name: "disabled role", role: func() identityclient.ActorRoleView { role := validRole; role.Enabled = false; return role }()},
		{name: "security disabled", role: func() identityclient.ActorRoleView { role := validRole; role.SecurityEnabled = false; return role }()},
		{name: "not activated", role: func() identityclient.ActorRoleView { role := validRole; role.ActivatedAt = nil; return role }()},
		{name: "missing actor version", role: func() identityclient.ActorRoleView { role := validRole; role.ActorVersion = 0; return role }()},
		{name: "missing role version", role: func() identityclient.ActorRoleView { role := validRole; role.RoleVersion = 0; return role }()},
		{name: "missing phone", role: func() identityclient.ActorRoleView { role := validRole; role.PhoneE164 = ""; return role }()},
		{name: "invalid phone", role: func() identityclient.ActorRoleView { role := validRole; role.PhoneE164 = "0771234567"; return role }()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if phone, ok := canonicalOfficialWalletPhone("partner", "actor_partner_1", test.role); ok || phone != "" {
				t.Fatalf("canonicalOfficialWalletPhone(%s)=(%q,%t), want empty and rejected", test.name, phone, ok)
			}
		})
	}
}

func TestCanonicalOfficialWalletNameRequiresCurrentVerifiedIdentityVersion(t *testing.T) {
	validName := identityclient.ActorLegalName{
		ActorID:    "actor_partner_1",
		Version:    3,
		GivenName:  " أحمد ",
		SecondName: "محمد",
		ThirdName:  "علي",
		FamilyName: "الهاشمي",
		Status:     "VERIFIED",
	}
	name, version, ok := canonicalOfficialWalletName("actor_partner_1", validName)
	if !ok || name != "أحمد محمد علي الهاشمي" || version != 3 {
		t.Fatalf("canonicalOfficialWalletName(valid name)=(%q,%d,%t), want canonical name, version 3, true", name, version, ok)
	}

	tests := []struct {
		name string
		item identityclient.ActorLegalName
	}{
		{name: "wrong actor", item: func() identityclient.ActorLegalName { item := validName; item.ActorID = "actor_other"; return item }()},
		{name: "pending name", item: func() identityclient.ActorLegalName {
			item := validName
			item.Status = "PENDING_VERIFICATION"
			return item
		}()},
		{name: "missing version", item: func() identityclient.ActorLegalName { item := validName; item.Version = 0; return item }()},
		{name: "missing part", item: func() identityclient.ActorLegalName { item := validName; item.ThirdName = " "; return item }()},
		{name: "name too long", item: func() identityclient.ActorLegalName {
			item := validName
			item.GivenName = strings.Repeat("ع", 80)
			item.SecondName = strings.Repeat("م", 80)
			item.ThirdName = strings.Repeat("ح", 80)
			item.FamilyName = strings.Repeat("د", 80)
			return item
		}()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if name, version, ok := canonicalOfficialWalletName("actor_partner_1", test.item); ok || name != "" || version != 0 {
				t.Fatalf("canonicalOfficialWalletName(%s)=(%q,%d,%t), want empty and rejected", test.name, name, version, ok)
			}
		})
	}
}

func TestOfficialWalletDestinationRequestRejectsClientIdentityFacts(t *testing.T) {
	for _, key := range []string{"providerKey", "walletIdentifier", "phone", "phoneE164", "beneficiaryName", "officialName"} {
		t.Run(key, func(t *testing.T) {
			body := `{"changeReason":"reason","verificationEvidenceReference":"verification","changeEvidenceReference":"change","` + key + `":"client-value"}`
			request := httptest.NewRequest("POST", "/", strings.NewReader(body))
			response := httptest.NewRecorder()
			var input struct {
				ChangeReason                  string `json:"changeReason"`
				VerificationEvidenceReference string `json:"verificationEvidenceReference"`
				ChangeEvidenceReference       string `json:"changeEvidenceReference"`
			}

			if decodeJSON(response, request, &input) {
				t.Fatalf("client supplied Identity fact %q was accepted", key)
			}
			if response.Code != 400 {
				t.Fatalf("client supplied Identity fact %q: status=%d, want 400", key, response.Code)
			}
		})
	}
}
