package identityboundary

import (
	"context"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type PartnerInput struct {
	ActorID   string
	Username  string
	PhoneE164 string
}

type Client struct {
	inner *identityclient.Client
}

func New(baseURL, serviceToken string) (*Client, error) {
	inner, err := identityclient.New(baseURL, "dsh", serviceToken)
	if err != nil {
		return nil, err
	}
	return &Client{inner: inner}, nil
}

func (c *Client) ProvisionPartner(ctx context.Context, operatorContextID string, input PartnerInput) (identityclient.ActorView, error) {
	return c.inner.ProvisionActor(ctx, operatorContextID, identityclient.ProvisionActorRequest{
		ActorID: input.ActorID, Username: input.Username, PhoneE164: input.PhoneE164, Role: "partner",
	})
}

func (c *Client) IssuePartnerActivation(ctx context.Context, operatorContextID, actorID, idempotencyKey, correlationID string) (identityclient.ActivationChallenge, error) {
	return c.inner.IssueActivation(ctx, operatorContextID, actorID, "partner", idempotencyKey, correlationID)
}
