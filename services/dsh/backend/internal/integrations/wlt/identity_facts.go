package wlt

// IdentityFacts are read by DSH from Identity immediately before a protected
// WLT operation. They are service-to-service evidence, never client input.
type IdentityFacts struct {
	ActorType           string `json:"actorType"`
	ActorID             string `json:"actorId"`
	PhoneE164           string `json:"phoneE164"`
	ActorVersion        int    `json:"actorVersion"`
	RoleVersion         int    `json:"roleVersion"`
	RoleEnabled         bool   `json:"roleEnabled"`
	SecurityEnabled     bool   `json:"securityEnabled"`
	OfficialName        string `json:"officialName"`
	OfficialNameVersion int    `json:"officialNameVersion"`
	OfficialNameStatus  string `json:"officialNameStatus"`
}
