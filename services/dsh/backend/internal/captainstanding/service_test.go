package captainstanding

import (
	"context"
	"errors"
	"testing"
)

type fakeIdentity struct {
	actor       Actor
	err         error
	allow       bool
	permissions int
}

func (f *fakeIdentity) Resolve(context.Context, string) (Actor, error) {
	return f.actor, f.err
}
func (f *fakeIdentity) RequireOperations(context.Context, string, string) error {
	f.permissions++
	if !f.allow {
		return ErrForbidden
	}
	return nil
}

type fakeStandingRepository struct {
	standing   Standing
	err        error
	changes    int
	lastChange Change
}

func (f *fakeStandingRepository) Read(context.Context, string) (Standing, error) {
	return f.standing, f.err
}
func (f *fakeStandingRepository) Change(_ context.Context, cmd Change) (Standing, error) {
	f.changes++
	f.lastChange = cmd
	if f.err != nil {
		return Standing{}, f.err
	}
	f.standing = Standing{ActorID: cmd.ActorID, Status: cmd.Status, Version: cmd.ExpectedVersion + 1}
	return f.standing, nil
}

func TestCaptainStandingSelfReadUsesCurrentIdentityAndDSHApproval(t *testing.T) {
	repo := &fakeStandingRepository{standing: Standing{ActorID: "captain-17", Status: Approved, Version: 2}}
	id := &fakeIdentity{actor: Actor{ID: "captain-17", Role: "customer"}}
	svc := NewService(id, repo)
	got, err := svc.ReadSelf(context.Background(), "opaque-owner-token", "customer")
	if err != nil || got.ActorID != "captain-17" || got.Version != 2 || got.Status != Approved {
		t.Fatalf("approved standing not read from owner: %+v, %v", got, err)
	}
	id.actor.Role = "captain"
	if _, err = svc.ReadSelf(context.Background(), "opaque-owner-token", "customer"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("wrong-role credential bypassed role boundary: %v", err)
	}
	repo.standing.Status = Suspended
	if _, err = svc.ReadSelf(context.Background(), "opaque-owner-token", "captain"); !errors.Is(err, ErrNotEligible) {
		t.Fatalf("suspended Captain was admitted: %v", err)
	}
	repo.standing.Status = Approved
	repo.standing.ActorID = "another-actor"
	if _, err = svc.ReadSelf(context.Background(), "opaque-owner-token", "captain"); !errors.Is(err, ErrOwnerUnavailable) {
		t.Fatalf("cross-actor DSH response accepted: %v", err)
	}
	id.err = ErrUnauthorized
	if _, err = svc.ReadSelf(context.Background(), "opaque-owner-token", "captain"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("invalid Identity session accepted: %v", err)
	}
}

func TestOnlyCurrentOperatorWithOperationsCanApproveStanding(t *testing.T) {
	repo := &fakeStandingRepository{}
	id := &fakeIdentity{actor: Actor{ID: "operator-1", Role: "operator"}}
	svc := NewService(id, repo)
	cmd := Change{ActorID: "captain-17", Status: Approved, ExpectedVersion: 1, OperationID: "admit-000017", Reason: "reviewed identity and eligibility"}
	if _, err := svc.Change(context.Background(), "operator-token", cmd); !errors.Is(err, ErrForbidden) || repo.changes != 0 {
		t.Fatalf("role-only operator mutated DSH standing: %v, changes=%d", err, repo.changes)
	}
	id.allow = true
	if got, err := svc.Change(context.Background(), "operator-token", cmd); err != nil || got.Version != 2 || got.Status != Approved || repo.changes != 1 {
		t.Fatalf("authorized standing mutation failed: %+v, %v", got, err)
	}
	id.actor.Role = "merchant"
	if _, err := svc.Change(context.Background(), "merchant-token", cmd); !errors.Is(err, ErrForbidden) || repo.changes != 1 {
		t.Fatalf("merchant changed Captain standing: %v, changes=%d", err, repo.changes)
	}
	id.actor.Role = "operator"
	cmd.ActorID = " "
	if _, err := svc.Change(context.Background(), "operator-token", cmd); !errors.Is(err, ErrInvalidChange) || repo.changes != 1 {
		t.Fatalf("invalid target mutated state: %v", err)
	}
}

func TestOperatorCannotApproveOwnCaptainStanding(t *testing.T) {
	id := &fakeIdentity{actor: Actor{ID: "operator-self", Role: "operator"}, allow: true}
	repo := &fakeStandingRepository{}
	svc := NewService(id, repo)
	cmd := Change{
		ActorID: "operator-self", Status: Approved, ExpectedVersion: 1,
		OperationID: "self-approval-0001", Reason: "only separate actor may approve",
	}
	if _, err := svc.Change(context.Background(), "operator-token", cmd); !errors.Is(err, ErrForbidden) || repo.changes != 0 {
		t.Fatalf("Operator approved own Captain standing: %v, writes=%d", err, repo.changes)
	}
	if id.permissions != 1 {
		t.Fatalf("must evaluate real operations permission before denying self-grant, checks=%d", id.permissions)
	}
}

func (f *fakeStandingRepository) Apply(_ context.Context, actorID string) (Standing, error) {
	if f.err != nil {
		return Standing{}, f.err
	}
	if f.standing.ActorID != "" {
		return f.standing, nil
	}
	f.standing = Standing{ActorID: actorID, Status: Pending, Version: 1}
	return f.standing, nil
}

func TestVerifiedCustomerApplicationNeverSelfApprovesCaptainRole(t *testing.T) {
	id := &fakeIdentity{actor: Actor{ID: "captain-17", Role: "customer"}}
	repo := &fakeStandingRepository{}
	svc := NewService(id, repo)
	first, err := svc.Apply(context.Background(), "customer-token")
	if err != nil || first.ActorID != "captain-17" || first.Status != Pending || first.Version != 1 {
		t.Fatalf("applicant may only enter a persistent pending standing: %+v %v", first, err)
	}
	second, err := svc.Apply(context.Background(), "customer-token")
	if err != nil || second != first {
		t.Fatalf("retry must not duplicate or change current standing: %+v %v", second, err)
	}
	if _, err = svc.ReadSelf(context.Background(), "customer-token", "customer"); !errors.Is(err, ErrNotEligible) {
		t.Fatalf("pending applicant gained approved role eligibility: %v", err)
	}
	cmd := Change{ActorID: "captain-17", Status: Approved, ExpectedVersion: 1, OperationID: "approve-001", Reason: "independent background and identity review"}
	if _, err = svc.Change(context.Background(), "customer-token", cmd); !errors.Is(err, ErrForbidden) || repo.changes != 0 {
		t.Fatalf("applicant approved own standing: %v", err)
	}
	id.actor = Actor{ID: "operator-1", Role: "operator"}
	id.allow = true
	result, err := svc.Change(context.Background(), "operator-token", cmd)
	if err != nil || result.Status != Approved || result.Version != 2 {
		t.Fatalf("authorized approval failed: %+v %v", result, err)
	}
	id.actor = Actor{ID: "captain-17", Role: "customer"}
	if read, err := svc.ReadSelf(context.Background(), "customer-token", "customer"); err != nil || read.Status != Approved {
		t.Fatalf("approved applicant not readable at owner: %+v %v", read, err)
	}
}

func TestSuspendedAndRevokedApplicantCannotRecoverAnApprovedCaptainStanding(t *testing.T) {
	for _, status := range []Status{Suspended, Revoked} {
		t.Run(string(status), func(t *testing.T) {
			existing := Standing{ActorID: "captain-17", Status: status, Version: 3}
			repo := &fakeStandingRepository{standing: existing}
			svc := NewService(&fakeIdentity{actor: Actor{ID: "captain-17", Role: "customer"}}, repo)
			if _, err := svc.Apply(context.Background(), "verified-customer"); !errors.Is(err, ErrNotEligible) {
				t.Fatalf("inactive applicant should be denied, got %v", err)
			}
			if repo.standing != existing || repo.changes != 0 {
				t.Fatalf("application changed previously inactive standing: %+v", repo.standing)
			}
		})
	}
}
