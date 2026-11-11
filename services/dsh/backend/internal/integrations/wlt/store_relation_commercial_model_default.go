package wlt

import (
	"context"
	"net/http"
)

type StoreRelationCommercialModelDefault struct {
	RelationModel    string `json:"relationModel"`
	CommercialModel  string `json:"commercialModel"`
	PolicyVersion    int    `json:"policyVersion"`
	UpdatedAt        string `json:"updatedAt"`
	ChangedByActorID string `json:"changedByActorId"`
	ChangeReason     string `json:"changeReason"`
}

type StoreRelationCommercialModelDefaultUpdate struct {
	RelationModel   string `json:"relationModel"`
	CommercialModel string `json:"commercialModel"`
	ExpectedVersion int    `json:"expectedVersion"`
	Reason          string `json:"reason"`
}

func (c *Client) ReadStoreRelationCommercialModelDefaults(ctx context.Context) ([]StoreRelationCommercialModelDefault, error) {
	var result struct {
		Defaults []StoreRelationCommercialModelDefault `json:"defaults"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/store-relation-commercial-model-defaults", nil, "", "", 0, &result)
	return result.Defaults, err
}

func (c *Client) UpdateStoreRelationCommercialModelDefault(ctx context.Context, input StoreRelationCommercialModelDefaultUpdate, idempotencyKey, correlationID, actingActorID string) (StoreRelationCommercialModelDefault, bool, error) {
	var result struct {
		Default          StoreRelationCommercialModelDefault `json:"default"`
		IdempotentReplay bool                                `json:"idempotentReplay"`
	}
	err := c.requestWithActor(ctx, actorRequest{
		method:         http.MethodPost,
		path:           "/wlt/v1/operator/store-relation-commercial-model-defaults",
		body:           input,
		idempotencyKey: idempotencyKey,
		correlationID:  correlationID,
		actingActorID:  actingActorID,
		target:         &result,
	})
	return result.Default, result.IdempotentReplay, err
}
