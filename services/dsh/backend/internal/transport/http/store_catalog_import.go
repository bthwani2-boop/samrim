package transporthttp

import (
	"io"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

const storeCatalogImportRequestBytes = 21 << 20

type storeCatalogImportUpload struct {
	filename string
	data     []byte
	storeID  string
}

func readStoreCatalogImportUpload(w http.ResponseWriter, r *http.Request, operator bool) (storeCatalogImportUpload, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, storeCatalogImportRequestBytes)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "upload must be one CSV or XLSX file no larger than 20 MiB")
		return storeCatalogImportUpload{}, false
	}
	if r.MultipartForm != nil {
		defer func() { _ = r.MultipartForm.RemoveAll() }()
	}
	if r.MultipartForm == nil || len(r.MultipartForm.File) != 1 || len(r.MultipartForm.File["file"]) != 1 || (operator && len(r.MultipartForm.Value) != 1) || (!operator && len(r.MultipartForm.Value) != 0) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "provide exactly one file and the required store scope")
		return storeCatalogImportUpload{}, false
	}
	files := r.MultipartForm.File["file"]
	file, err := files[0].Open()
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog import file could not be read")
		return storeCatalogImportUpload{}, false
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, (20<<20)+1))
	if err != nil || len(data) == 0 || len(data) > (20<<20) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog import file must contain between 1 byte and 20 MiB")
		return storeCatalogImportUpload{}, false
	}
	storeID := strings.TrimSpace(r.FormValue("storeId"))
	if operator && (storeID == "" || len(storeID) > 128) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is required for operator store-catalog imports")
		return storeCatalogImportUpload{}, false
	}
	return storeCatalogImportUpload{filename: files[0].Filename, data: data, storeID: storeID}, true
}

func (s *CatalogServer) previewPartnerStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	file, ok := readStoreCatalogImportUpload(w, r, false)
	if !ok {
		return
	}
	result, err := s.service.PreviewPartnerStoreCatalogImport(r.Context(), bearerToken(r), r.PathValue("storeId"), file.filename, file.data, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogImportPreview(w, result)
}

func (s *CatalogServer) readPartnerStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ReadPartnerStoreCatalogImport(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("runId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportRunResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items)})
}

func (s *CatalogServer) commitPartnerStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	result, err := s.service.CommitPartnerStoreCatalogImport(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("runId"), idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportCommitResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) previewFieldStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	file, ok := readStoreCatalogImportUpload(w, r, false)
	if !ok {
		return
	}
	result, err := s.service.PreviewFieldStoreCatalogImport(r.Context(), bearerToken(r), r.PathValue("caseId"), file.filename, file.data, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogImportPreview(w, result)
}

func (s *CatalogServer) readFieldStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ReadFieldStoreCatalogImport(r.Context(), bearerToken(r), r.PathValue("caseId"), r.PathValue("runId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportRunResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items)})
}

func (s *CatalogServer) commitFieldStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	result, err := s.service.CommitFieldStoreCatalogImport(r.Context(), bearerToken(r), r.PathValue("caseId"), r.PathValue("runId"), idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportCommitResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) previewOperatorStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	file, ok := readStoreCatalogImportUpload(w, r, true)
	if !ok {
		return
	}
	result, err := s.service.PreviewOperatorStoreCatalogImport(r.Context(), acting, file.storeID, file.filename, file.data, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogImportPreview(w, result)
}

func (s *CatalogServer) readOperatorStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	result, err := s.service.ReadOperatorStoreCatalogImport(r.Context(), acting, r.PathValue("runId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportRunResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items)})
}

func (s *CatalogServer) commitOperatorStoreCatalogImport(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	result, err := s.service.CommitOperatorStoreCatalogImport(r.Context(), acting, r.PathValue("runId"), idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportCommitResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items), IdempotentReplay: result.Replayed})
}

func writeCatalogImportPreview(w http.ResponseWriter, result postgres.CatalogImportPreviewResult) {
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.CatalogImportPreviewResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items), IdempotentReplay: result.Replayed})
}
