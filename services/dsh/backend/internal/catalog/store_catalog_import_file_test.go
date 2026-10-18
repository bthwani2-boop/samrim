package catalog

import (
	"fmt"
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
		{"inventory.csv", "ignored,price\nTea,50\n"},
		{"inventory.csv", "barcode,price\n\"unterminated,20\n"},
	} {
		if _, err := ParseStoreCatalogImportFile(test.name, []byte(test.body)); err == nil {
			t.Errorf("ParseStoreCatalogImportFile(%q) succeeded", test.name)
		}
	}
}

func TestParseStoreCatalogImportAcceptsFiveThousandRowsWithPartialErrors(t *testing.T) {
	var csv strings.Builder
	csv.WriteString("barcode,price\n")
	for i := 0; i < MaxStoreCatalogImportRows; i++ {
		if i == 253 {
			csv.WriteString("6291000000253,invalid\n")
		} else {
			fmt.Fprintf(&csv, "6291000%06d,1250\n", i)
		}
	}
	rows, err := ParseStoreCatalogImportFile("full-batch.csv", []byte(csv.String()))
	if err != nil {
		t.Fatalf("5000-row preview was rejected: %v", err)
	}
	if len(rows) != MaxStoreCatalogImportRows || rows[0].RowNumber != 2 || rows[len(rows)-1].RowNumber != MaxStoreCatalogImportRows+1 {
		t.Fatalf("row count/position not retained: count=%d first=%d last=%d", len(rows), rows[0].RowNumber, rows[len(rows)-1].RowNumber)
	}
	if rows[253].ErrorCode != "INVALID_INPUT" || rows[252].ErrorCode != "" || rows[254].ErrorCode != "" {
		t.Fatalf("one invalid row must not invalidate adjacent valid rows: before=%q invalid=%q after=%q", rows[252].ErrorCode, rows[253].ErrorCode, rows[254].ErrorCode)
	}
}

func TestParseStoreCatalogImportUnknownUnitCannotBeHiddenByValidPrice(t *testing.T) {
	rows, err := ParseStoreCatalogImportFile("unknown-unit.csv", []byte("name,unit,price\nUnknown item,BAD_UNIT,500\n"))
	if err != nil || len(rows) != 1 || rows[0].ErrorCode != "INVALID_INPUT" {
		t.Fatalf("invalid unit was accepted: %+v err=%v", rows, err)
	}
}
func TestParseStoreCatalogImportAcceptsUnbarcodedLocalProducts(t *testing.T) {
	data := []byte("اسم المنتج,السعر,الوحدة,الحجم\nعصير فراولة,900,ملليلتر,الكوب\nبيتزا خاصة,2500,قطعة,الافتراضي\n,500,قطعة,\n")
	rows, err := ParseStoreCatalogImportFile("local-items.csv", data)
	if err != nil || len(rows) != 3 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	if rows[0].Name != "عصير فراولة" || rows[0].Barcode != "" || rows[0].PriceMinor != 900 || rows[0].MeasurementKind != "MEASURED" || rows[0].BaseUnit != "MILLILITER" || rows[0].VariantTitle != "الكوب" {
		t.Fatalf("measured local product lost CSV fields: %+v", rows[0])
	}
	if rows[1].Name != "بيتزا خاصة" || rows[1].PriceMinor != 2500 || rows[1].MeasurementKind != "DISCRETE" || rows[1].BaseUnit != "COUNT" || rows[1].ErrorCode != "" {
		t.Fatalf("discrete Store-local Product invalid: %+v", rows[1])
	}
	if rows[2].ErrorCode != "INVALID_INPUT" {
		t.Fatalf("missing name was accepted: %+v", rows[2])
	}
}
