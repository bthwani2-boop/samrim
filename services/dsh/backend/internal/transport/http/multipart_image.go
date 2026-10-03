package transporthttp

import (
	"io"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
)

func readMultipartImageUpload(w http.ResponseWriter, r *http.Request, invalidFormMessage string) ([]byte, string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+(64*1024))
	parseErr := r.ParseMultipartForm(media.MaxUploadBytes)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if parseErr != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", invalidFormMessage)
		return nil, "", false
	}
	file, header, err := r.FormFile("file")
	if err != nil || header == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a file field is required")
		return nil, "", false
	}
	defer file.Close()
	if header.Size < 1 || header.Size > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return nil, "", false
	}
	data, err := io.ReadAll(io.LimitReader(file, media.MaxUploadBytes+1))
	if err != nil || int64(len(data)) > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return nil, "", false
	}
	return data, strings.TrimSpace(header.Header.Get("Content-Type")), true
}
