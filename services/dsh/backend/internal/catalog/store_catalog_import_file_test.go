package catalog

import (
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseStoreCatalogImportCSVAllowsPartialInvalidRowsAndArabicDigits(t *testing.T) {
	rows, err := ParseStoreCatalogImportFile("inventory.csv", []byte("الباركود,السعر\n6291000000012,١٬٢٥٠\n6291000000013,غير صالح\n,500\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(rows))
	}
	if rows[0].RowNumber != 2 || rows[0].Barcode != "6291000000012" || rows[0].PriceMinor != 1250 || rows[0].ErrorCode != "" {
		t.Fatalf("valid row = %+v", rows[0])
	}
	if rows[1].ErrorCode != "INVALID_INPUT" || rows[2].ErrorCode != "INVALID_INPUT" {
		t.Fatalf("invalid rows were not retained for review: %+v", rows[1:])
	}
}

func TestParseStoreCatalogImportXLSXAndRejectsOver5000Rows(t *testing.T) {
	book := excelize.NewFile()
	defer func() { _ = book.Close() }()
	if err := book.SetCellValue("Sheet1", "A1", "Barcode"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("Sheet1", "B1", "Price"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("Sheet1", "A2", "6291000000012"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("Sheet1", "B2", 1250); err != nil {
		t.Fatal(err)
	}
	data, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	rows, err := ParseStoreCatalogImportFile("inventory.xlsx", data.Bytes())
	if err != nil || len(rows) != 1 || rows[0].PriceMinor != 1250 {
		t.Fatalf("XLSX rows=%+v error=%v", rows, err)
	}
	var csv strings.Builder
	csv.WriteString("barcode,price\n")
	for i := 0; i <= MaxStoreCatalogImportRows; i++ {
		csv.WriteString("6291000000012,1250\n")
	}
	if _, err := ParseStoreCatalogImportFile("too-many.csv", []byte(csv.String())); err == nil {
		t.Fatal("expected imports above 5000 rows to be rejected")
	}
}

func TestParseStoreCatalogImportRejectsUnsupportedOrMalformedFiles(t *testing.T) {
	for _, test := range []struct{ name, body string }{
		{"inventory.json", "{}"},
		{"inventory.csv", "name,price\nTea,50\n"},
		{"inventory.csv", "barcode,price\n\"unterminated,20\n"},
	} {
		if _, err := ParseStoreCatalogImportFile(test.name, []byte(test.body)); err == nil {
			t.Errorf("ParseStoreCatalogImportFile(%q) succeeded", test.name)
		}
	}
}
