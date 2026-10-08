package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *FieldFinanceServer) listOperatorFieldActivity(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "partners") {
		return
	}
	fieldActorIDs := r.URL.Query()["fieldActorId"]
	if len(fieldActorIDs) < 1 || len(fieldActorIDs) > 50 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "between 1 and 50 fieldActorId values are required")
		return
	}
	seen := make(map[string]struct{}, len(fieldActorIDs))
	for index, actorID := range fieldActorIDs {
		actorID = strings.TrimSpace(actorID)
		if actorID == "" || len(actorID) > 128 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "fieldActorId values must be valid Field actors")
			return
		}
		if _, exists := seen[actorID]; exists {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "fieldActorId values must be unique")
			return
		}
		seen[actorID] = struct{}{}
		fieldActorIDs[index] = actorID
	}

	activities, err := postgres.ListLatestStoresForFields(r.Context(), s.db, fieldActorIDs)
	if err != nil {
		writeError(w, http.StatusBadGateway, "FIELD_ACTIVITY_READ_UNAVAILABLE", "Field activity could not be read")
		return
	}
	items := make([]contract.OperatorFieldActivitySummary, 0, len(activities))
	for _, activity := range activities {
		item := contract.OperatorFieldActivitySummary{
			FieldActorID:     activity.FieldActorID,
			JoiningCaseCount: activity.JoiningCaseCount,
		}
		if activity.LatestJoiningCase != nil {
			item.LatestJoiningCase = &contract.OperatorFieldLatestJoiningCase{
				ID:          activity.LatestJoiningCase.ID,
				DisplayName: activity.LatestJoiningCase.DisplayName,
				State:       activity.LatestJoiningCase.State,
				CreatedAt:   activity.LatestJoiningCase.CreatedAt,
			}
		}
		if activity.LatestStore != nil {
			item.LatestStore = &contract.OperatorFieldLatestStore{
				StoreID:       activity.LatestStore.StoreID,
				StoreName:     activity.LatestStore.StoreName,
				JoiningCaseID: activity.LatestStore.JoiningCaseID,
				CreatedAt:     activity.LatestStore.CreatedAt,
			}
		}
		items = append(items, item)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.OperatorFieldActivityResponse{Items: items})
}
