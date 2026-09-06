package identityboundary

import (
	"context"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ActorInput struct{ PhoneE164 string }

type Client struct{ inner *identityclient.Client }

func New(baseURL, serviceToken string) (*Client, error) {
	inner, err := identityclient.New(baseURL, serviceToken)
	if err != nil {
		return nil, err
	}
	return &Client{inner: inner}, nil
}

func (c *Client) provision(ctx context.Context, role string, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.inner.ProvisionRole(ctx, identityclient.ProvisionActorRoleRequest{PhoneE164: input.PhoneE164, Role: role})
}
func (c *Client) ProvisionPartner(ctx context.Context, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "partner", input)
}
func (c *Client) ProvisionCaptain(ctx context.Context, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "captain", input)
}
func (c *Client) ProvisionField(ctx context.Context, input ActorInput) (identityclient.ActorRoleView, error) {
	return c.provision(ctx, "field", input)
}

func (c *Client) SetPartnerEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.inner.SetRoleEnabled(ctx, actorID, "partner", enabled, correlationID)
}
func (c *Client) SetCaptainEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.inner.SetRoleEnabled(ctx, actorID, "captain", enabled, correlationID)
}
func (c *Client) SetFieldEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.inner.SetRoleEnabled(ctx, actorID, "field", enabled, correlationID)
}

func (c *Client) AuthorizePartnerReenrollment(ctx context.Context, actorID, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, "partner", correlationID)
}
func (c *Client) AuthorizeCaptainReenrollment(ctx context.Context, actorID, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, "captain", correlationID)
}
func (c *Client) AuthorizeFieldReenrollment(ctx context.Context, actorID, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, "field", correlationID)
}
func (c *Client) AuthorizeReenrollment(ctx context.Context, actorID, role, correlationID string) error {
	return c.inner.AuthorizeReenrollment(ctx, actorID, role, correlationID)
}
func (c *Client) AuthorizeReenrollmentByPhone(ctx context.Context, phone, role, correlationID string) error {
	return c.inner.AuthorizeReenrollmentByPhone(ctx, phone, role, correlationID)
}
func (c *Client) LookupRoleByPhone(ctx context.Context, phone, role string) (identityclient.ActorRoleView, error) {
	return c.inner.LookupRoleByPhone(ctx, role, phone)
}
func (c *Client) Readiness(ctx context.Context) error { return c.inner.Readiness(ctx) }
