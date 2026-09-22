package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	notificationdomain "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/notification"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type NotificationServer struct {
	auth    *auth.ServiceToken
	service *notificationdomain.Service
}

func NewNotification(identityClient *identityintegration.Client, accessToken string, db *sql.DB) (*NotificationServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := notificationdomain.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &NotificationServer{auth: authorizer, service: service}, nil
}

func (s *NotificationServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/notifications", s.list)
	mux.HandleFunc("POST /dsh/notifications/{notificationId}/read", s.markRead)
}

func (s *NotificationServer) list(w http.ResponseWriter, r *http.Request) {
	if s.auth.Authorized(r) {
		actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if actingActorID == "" || len(actingActorID) > 128 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
			return
		}
		limit := 50
		if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 1 || parsed > 100 {
				writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
				return
			}
			limit = parsed
		}
		result, err := s.service.ListForOperator(r.Context(), actingActorID, limit)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		writeNotificationList(w, result)
		return
	}
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "user session is required")
		return
	}
	limit := 50
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	result, err := s.service.List(r.Context(), token, limit)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeNotificationList(w, result)
}

func (s *NotificationServer) markRead(w http.ResponseWriter, r *http.Request) {
	notificationID := strings.TrimSpace(r.PathValue("notificationId"))
	if s.auth.Authorized(r) {
		actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if actingActorID == "" || len(actingActorID) > 128 || notificationID == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID and notificationId are required")
			return
		}
		readAt, err := s.service.MarkReadForOperator(r.Context(), actingActorID, notificationID)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, contract.NotificationReadResponse{NotificationID: notificationID, ReadAt: readAt})
		return
	}
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "user session is required")
		return
	}
	if notificationID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "notificationId is required")
		return
	}
	readAt, err := s.service.MarkRead(r.Context(), token, notificationID)
	if err != nil {
		writeNotificationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.NotificationReadResponse{NotificationID: notificationID, ReadAt: readAt})
}

func writeNotificationList(w http.ResponseWriter, result notificationdomain.ListResult) {
	items := make([]contract.Notification, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, contract.Notification{ID: item.ID, Kind: contract.NotificationKind(item.Kind), Title: item.Title, Body: item.Body, OrderID: item.OrderID, CreatedAt: item.CreatedAt, ReadAt: item.ReadAt})
	}
	writeJSON(w, http.StatusOK, contract.NotificationListResponse{Notifications: items, UnreadCount: result.UnreadCount})
}

func writeNotificationError(w http.ResponseWriter, err error) {
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		writeIdentityError(w, err)
		return
	}
	switch {
	case errors.Is(err, notificationdomain.ErrSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active client, partner, captain, field, or control operator session is required")
	case errors.Is(err, postgres.ErrNotificationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "notification was not found")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "notification storage is unavailable")
	}
}
