package customercart

import (
	jsonv2 "encoding/json/v2"
	"io"
	"mime"
	"net/http"
	"strings"
)

// decodeCustomerCommand is the single Customer owner body admission boundary.
// Native apps use verified bearer transport; Web commands go through the
// same-origin Customer BFF, never directly through a browser cross-origin POST.
// Native JSON v2 rejects duplicate (including escaped) names, malformed
// Unicode, unknown fields, case variants and trailing JSON values. Required
// member presence and domain limits remain explicit in each typed command.
func decodeCustomerCommand(w http.ResponseWriter, r *http.Request, limit int64, dst any) bool {
	media := r.Header.Values("Content-Type")
	site := r.Header.Values("Sec-Fetch-Site")
	if len(media) != 1 || len(r.Header.Values("Content-Encoding")) != 0 ||
		len(r.Header.Values("Origin")) != 0 || len(site) > 1 ||
		(len(site) == 1 && strings.EqualFold(site[0], "cross-site")) ||
		r.URL.RawQuery != "" || r.URL.ForceQuery || r.Body == nil || r.ContentLength > limit {
		return false
	}
	kind, params, err := mime.ParseMediaType(media[0])
	if err != nil || kind != "application/json" {
		return false
	}
	for key, value := range params {
		if key != "charset" || !strings.EqualFold(value, "utf-8") {
			return false
		}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	return err == nil && jsonv2.Unmarshal(body, dst, jsonv2.RejectUnknownMembers(true)) == nil
}
