package postgres

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestBuildSettlementBatchXLSXUsesInlineStrings(t *testing.T) {
	content, err := buildSettlementBatchXLSX([][]string{
		{"row_sequence", "payout_id", "beneficiary"},
		{"1", "pay-1", "=HYPERLINK(\"https://invalid\")"},
	})
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatalf("generated workbook is not a ZIP package: %v", err)
	}
	var worksheet string
	for _, file := range archive.File {
		if file.Name != "xl/worksheets/sheet1.xml" {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		worksheet = string(data)
	}
	if worksheet == "" {
		t.Fatal("generated workbook has no worksheet")
	}
	if strings.Contains(worksheet, "<f>") || !strings.Contains(worksheet, `t="inlineStr"`) || !strings.Contains(worksheet, "=HYPERLINK") {
		t.Fatalf("untrusted text must remain an inline string, worksheet: %s", worksheet)
	}
}
