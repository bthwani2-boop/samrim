package joiningcase

import (
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
	"testing"
)

func TestSelfServiceApplicantRequiresVerifiedClientRole(t *testing.T) {
	session := identityclient.ActorIdentity{Subject: "actor-a", Role: "client", Surface: "app-client"}
	actor := identityclient.ActorRoleView{ActorID: "actor-a", Role: "client", PhoneE164: "+967777123456", Enabled: true, SecurityEnabled: true}
	if !validProspectIdentity(session, actor) {
		t.Fatal("valid client applicant rejected")
	}
	invalid := []struct {
		name    string
		session identityclient.ActorIdentity
		role    identityclient.ActorRoleView
	}{
		{"partner token", identityclient.ActorIdentity{Subject: "actor-a", Role: "partner", Surface: "app-partner"}, actor},
		{"field surface", identityclient.ActorIdentity{Subject: "actor-a", Role: "client", Surface: "app-field"}, actor},
		{"switched account", session, identityclient.ActorRoleView{ActorID: "actor-b", Role: "client", PhoneE164: actor.PhoneE164, Enabled: true, SecurityEnabled: true}},
		{"disabled role", session, identityclient.ActorRoleView{ActorID: "actor-a", Role: "client", PhoneE164: actor.PhoneE164, Enabled: false, SecurityEnabled: true}},
		{"disabled security", session, identityclient.ActorRoleView{ActorID: "actor-a", Role: "client", PhoneE164: actor.PhoneE164, Enabled: true, SecurityEnabled: false}},
		{"no verified phone", session, identityclient.ActorRoleView{ActorID: "actor-a", Role: "client", Enabled: true, SecurityEnabled: true}},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			if validProspectIdentity(tc.session, tc.role) {
				t.Fatal("invalid applicant accepted")
			}
		})
	}
}
