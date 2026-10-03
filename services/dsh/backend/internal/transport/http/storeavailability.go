package transporthttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type StoreAvailabilityServer struct {
	operatorAuth *auth.ServiceToken
	service      *storeavailability.Service
}

type storeAvailabilityMutationRequest struct {
	ScheduleMode                string                         `json:"scheduleMode"`
	WeeklySchedule              []postgres.StoreScheduleWindow `json:"weeklySchedule"`
	Paused                      bool                           `json:"paused"`
	PauseReason                 *string                        `json:"pauseReason,omitempty"`
	PauseUntil                  *time.Time                      `json:"pauseUntil,omitempty"`
	PreparationMinutes          *int                            `json:"preparationMinutes,omitempty"`
	UnavailableFulfillmentModes []string                        `json:"unavailableFulfillmentModes"`
}

type storeAvailabilityMutationResponse struct {
	Availability     postgres.StoreOperationalAvailability `json:"availability"`
	IdempotentReplay bool                                  `json:"idempotentReplay"`
}

func NewStoreAvailability(identityClient *identityintegration.Client, operatorServiceToken string, db interface {
}) (*StoreAvailabilityServer, error) {
	return nil, errors.New("invalid Store availability constructor")
}
