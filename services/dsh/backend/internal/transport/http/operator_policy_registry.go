package transporthttp

import (
	"net/http"
	"strings"

	"github.com/lib/pq"
)

func (s *OperatorPolicyServer) readOperatorPolicyRegistry(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "platform_policies") {
		return
	}
	out, err := s.payment.ReadOperatorPolicyRegistry(r.Context())
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	cities := make([]string, 0, len(out.DeliveryFees))
	types := make([]string, 0, len(out.FieldRewards))
	for _, fee := range out.DeliveryFees {
		if fee.ServiceCityID != "" {
			cities = append(cities, fee.ServiceCityID)
		}
	}
	for _, reward := range out.FieldRewards {
		types = append(types, reward.ScopeID)
	}
	cityNames := map[string]string{}
	typeNames := map[string]string{}
	if len(cities) > 0 {
		rows, err := s.db.QueryContext(r.Context(), "SELECT id,display_name_ar FROM dsh.service_cities WHERE id=ANY($1)", pq.Array(cities))
		if err != nil {
			writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "service city policy names unavailable")
			return
		}
		for rows.Next() {
			var id, name string
			if err = rows.Scan(&id, &name); err != nil {
				rows.Close()
				writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "city policy names unavailable")
				return
			}
			cityNames[id] = name
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "city policy names unavailable")
			return
		}
	}
	if len(types) > 0 {
		rows, err := s.db.QueryContext(r.Context(), "SELECT id,name_ar FROM dsh.commercial_store_types WHERE id=ANY($1)", pq.Array(types))
		if err != nil {
			writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "store type policy names unavailable")
			return
		}
		for rows.Next() {
			var id, name string
			if err = rows.Scan(&id, &name); err != nil {
				rows.Close()
				writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "store type policy names unavailable")
				return
			}
			typeNames[id] = name
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "store type policy names unavailable")
			return
		}
	}
	fees := make([]map[string]any, 0, len(out.DeliveryFees))
	for _, p := range out.DeliveryFees {
		label := "القاعدة العامة"
		if p.ServiceCityID != "" {
			label = cityNames[p.ServiceCityID]
			if label == "" {
				label = p.ServiceCityID
			}
		}
		fees = append(fees, map[string]any{"id": p.ServiceCityID, "name": label, "distanceBands": p.DistanceBands, "policyVersion": p.PolicyVersion, "version": p.Version, "createdAt": p.CreatedAt, "createdBy": p.CreatedBy})
	}
	rewards := make([]map[string]any, 0, len(out.FieldRewards))
	for _, p := range out.FieldRewards {
		name := typeNames[p.ScopeID]
		if name == "" {
			name = p.ScopeID
		}
		rewards = append(rewards, map[string]any{"id": p.ScopeID, "name": name, "rewardMinor": p.RewardMinor, "version": p.Version, "createdAt": p.CreatedAt, "createdBy": p.CreatedBy})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"deliveryFees": fees, "deliveryTotal": out.DeliveryTotal, "fieldRewards": rewards, "fieldTotal": out.FieldTotal})
}
