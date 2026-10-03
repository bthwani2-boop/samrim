package actor

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func TestReadCanonicalActorRequiresDSHAndValidActorID(t *testing.T) {
	service := New(nil)
	for _, test := range []struct {
		name, caller, actorID string
		want                  error
	}{
		{name: "control panel caller", caller: "control-panel", actorID: "actor-1", want: domain.ErrForbidden},
		{name: "empty actor ID", caller: "dsh", actorID: " ", want: domain.ErrInvalidInput},
		{name: "overlong actor ID", caller: "dsh", actorID: strings.Repeat("a", 129), want: domain.ErrInvalidInput},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := service.ReadCanonicalActor(context.Background(), test.caller, test.actorID); !errors.Is(err, test.want) {
				t.Fatalf("ReadCanonicalActor() error = %v, want %v", err, test.want)
			}
		})
	}
}
