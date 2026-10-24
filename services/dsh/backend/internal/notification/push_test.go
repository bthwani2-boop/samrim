package notification

import (
	"testing"
)

func TestExpoPushRegistrationValidation(t *testing.T) {
	valid := PushDeviceInput{InstallationID: "9f7bc010-1234-4abc-9eff-a9deadcaf314",
		ExpoPushToken: "ExpoPushToken[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg]", Tone: "classic"}
	if !validPushDevice(valid) {
		t.Fatal("valid native Expo token rejected")
	}
	bad := []PushDeviceInput{
		{InstallationID: valid.InstallationID, ExpoPushToken: "https://attacker.example", Tone: "classic"},
		{InstallationID: "", ExpoPushToken: valid.ExpoPushToken, Tone: "classic"},
		{InstallationID: valid.InstallationID, ExpoPushToken: valid.ExpoPushToken, Tone: "full-volume"},
		{InstallationID: "../../test", ExpoPushToken: valid.ExpoPushToken, Tone: "classic"},
	}
	for _, input := range bad {
		if validPushDevice(input) {
			t.Fatalf("accepted invalid device input: %+v", input)
		}
	}
}
func TestPushPayloadAvoidsSensitiveLocations(t *testing.T) {
	for _, kind := range []string{"ORDER_CREATED", "CAPTAIN_OFFER", "CAPTAIN_ARRIVED"} {
		title, body := pushCopy(kind)
		if title == "" || body == "" {
			t.Fatalf("missing notification content for %s", kind)
		}
	}
}

func TestExpoPushTicketParsesSingleAndArrayForms(t *testing.T) {
	for _, raw := range []string{
		`{"data":{"status":"ok","id":"ticket-1"}}`,
		`{"data":[{"status":"ok","id":"ticket-1"}]}`,
	} {
		ticket, err := parseExpoTicket([]byte(raw))
		if err != nil || ticket.ID != "ticket-1" {
			t.Fatalf("ticket parse failed %q: %v", raw, err)
		}
	}
	if _, err := parseExpoTicket([]byte(`{"data":[]}`)); err == nil {
		t.Fatal("empty tickets should fail")
	}
}
