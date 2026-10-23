package postgres

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestFinanceEvidenceRejectsSpoofedMedia(t *testing.T) {
	pdf := []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF")
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 18)...)
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 0x01, 0x01}
	csv := []byte("reference,amount\nreceipt-01,1000\n")

	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for _, name := range []string{"[Content_Types].xml", "xl/workbook.xml"} {
		w, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte("<Types/>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	xlsx := buffer.Bytes()

	cases := []struct {
		name, contentType string
		content           []byte
		allowed           bool
	}{
		{"valid_pdf_header", "application/pdf", pdf, true},
		{"pdf_labeled_jpeg", "image/jpeg", pdf, false},
		{"text_labeled_pdf", "application/pdf", []byte("this is not a PDF"), false},
		{"valid_png_header", "image/png", png, true},
		{"png_labeled_jpeg", "image/jpeg", png, false},
		{"valid_jpeg_header", "image/jpeg", jpeg, true},
		{"jpeg_labeled_png", "image/png", jpeg, false},
		{"valid_csv", "text/csv", csv, true},
		{"csv_with_binary_null", "text/csv", []byte("amount,reference\x00,1000"), false},
		{"csv_with_pdf_bytes", "text/csv", pdf, false},
		{"valid_xlsx_container", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx, true},
		{"zip_without_office_workbook", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []byte("PK\x03\x04"), false},
		{"empty", "application/pdf", nil, false},
		{"oversize", "application/pdf", bytes.Repeat([]byte("x"), 10*1024*1024+1), false},
		{"unknown_media", "application/octet-stream", pdf, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validEvidenceContent(tc.contentType, tc.content); got != tc.allowed {
				t.Fatalf("validEvidenceContent(%q, %d bytes)=%v, want %v", tc.contentType, len(tc.content), got, tc.allowed)
			}
		})
	}
}

func TestFinanceEvidencePurposeAllowsOnlyRelevantMedia(t *testing.T) {
	for _, tt := range []struct {
		purpose, contentType string
		ok                   bool
	}{
		{"TRANSFER_RECEIPT", "application/pdf", true},
		{"TRANSFER_RECEIPT", "image/jpeg", true},
		{"TRANSFER_RECEIPT", "image/png", true},
		{"TRANSFER_RECEIPT", "text/csv", false},
		{"TRANSFER_RECEIPT", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", false},
		{"SETTLEMENT_STATEMENT", "text/csv", true},
		{"SETTLEMENT_STATEMENT", "application/pdf", true},
		{"SETTLEMENT_STATEMENT", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true},
		{"SETTLEMENT_BATCH_EXPORT", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true},
		{"SETTLEMENT_BATCH_EXPORT", "application/pdf", false},
		{"CUSTOMER_WITHDRAWAL_REQUEST", "image/jpeg", true},
		{"CUSTOMER_WITHDRAWAL_REQUEST", "text/csv", false},
	} {
		if got := validEvidencePurposeMedia(tt.purpose, tt.contentType); got != tt.ok {
			t.Errorf("purpose=%s media=%s got=%t want=%t", tt.purpose, tt.contentType, got, tt.ok)
		}
	}
}
