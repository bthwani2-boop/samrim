package catalog

import (
	"bytes"
	"errors"
	"testing"

	"github.com/xuri/excelize/v2"
)

func storeImportWorkbook(t *testing.T, extraCell string) []byte {
	t.Helper()
	book := excelize.NewFile()
	t.Cleanup(func() { _ = book.Close() })
	for cell, value := range map[string]string{
		"A1": "name",
		"B1": "price",
		"A2": "Fresh milk",
		"B2": "250",
	} {
		if err := book.SetCellStr("Sheet1", cell, value); err != nil {
			t.Fatalf("set %s: %v", cell, err)
		}
	}
	if extraCell != "" {
		if err := book.SetCellStr("Sheet1", extraCell, "Far row"); err != nil {
			t.Fatalf("set distant cell: %v", err)
		}
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatalf("build XLSX: %v", err)
	}
	return bytes.Clone(buffer.Bytes())
}

func TestParseStoreCatalogImportFileXLSXBoundedStreaming(t *testing.T) {
	data := storeImportWorkbook(t, "")
	got, err := ParseStoreCatalogImportFile("catalog.xlsx", data)
	if err != nil {
		t.Fatalf("valid workbook rejected: %v", err)
	}
	if len(got) != 1 || got[0].RowNumber != 2 || got[0].Name != "Fresh milk" || got[0].PriceMinor != 250 || got[0].ErrorCode != "" {
		t.Fatalf("import result changed: %+v", got)
	}
	csvRows, err := ParseStoreCatalogImportFile("catalog.csv", []byte("name,price\nFresh milk,250\n"))
	if err != nil || len(csvRows) != len(got) || csvRows[0].Name != got[0].Name || csvRows[0].PriceMinor != got[0].PriceMinor {
		t.Fatalf("CSV/XLSX mismatch: csv=%+v xlsx=%+v err=%v", csvRows, got, err)
	}
}

func TestParseStoreCatalogImportFileXLSXAcceptsBoundaryRow(t *testing.T) {
	data := storeImportWorkbook(t, "A5001")
	rows, err := ParseStoreCatalogImportFile("catalog.xlsx", data)
	if err != nil {
		t.Fatalf("last permitted worksheet row rejected: %v", err)
	}
	if len(rows) != 2 || rows[1].RowNumber != MaxStoreCatalogImportRows+1 {
		t.Fatalf("sparse workbook lost row position: %+v", rows)
	}
}

func TestParseStoreCatalogImportFileXLSXRejectsSparseExcessBeforeMaterialization(t *testing.T) {
	data := storeImportWorkbook(t, "A5002")
	_, err := ParseStoreCatalogImportFile("catalog.xlsx", data)
	if !errors.Is(err, ErrStoreCatalogImportFile) {
		t.Fatalf("sparse worksheet beyond the %d-row limit must be rejected, got: %v", MaxStoreCatalogImportRows, err)
	}
}

func TestParseStoreCatalogImportFileXLSXRejectsInvalidBytes(t *testing.T) {
	_, err := ParseStoreCatalogImportFile("catalog.xlsx", []byte("not an XLSX"))
	if !errors.Is(err, ErrStoreCatalogImportFile) {
		t.Fatalf("malformed workbook must be rejected, got %v", err)
	}
}
