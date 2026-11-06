package catalog

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
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

func TestParseStoreCatalogImportFileArabicNamePriceAndMixedRows(t *testing.T) {
	data := []byte("اسم المنتج,السعر,الوحدة,النوع\nقهوة عربية,٢٥٠,غرام,كبير\nخبز,غير صالح,قطعة,\nأرز يمني,١٤٠,قطعة,\n")
	rows, err := ParseStoreCatalogImportFile("catalog.csv", data)
	if err != nil {
		t.Fatalf("mixed valid/invalid CSV must be previewable: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected three nonempty rows, got %d", len(rows))
	}
	if rows[0].RowNumber != 2 || rows[0].Name != "قهوة عربية" || rows[0].PriceMinor != 250 ||
		rows[0].MeasurementKind != "MEASURED" || rows[0].BaseUnit != "GRAM" ||
		rows[0].VariantTitle != "كبير" || rows[0].ErrorCode != "" {
		t.Fatalf("Arabic name-only row lost information: %+v", rows[0])
	}
	if rows[1].RowNumber != 3 || rows[1].ErrorCode != "INVALID_INPUT" {
		t.Fatalf("invalid row must be retained for review: %+v", rows[1])
	}
	if rows[2].RowNumber != 4 || rows[2].PriceMinor != 140 || rows[2].ErrorCode != "" {
		t.Fatalf("valid row after invalid row must survive: %+v", rows[2])
	}

	barcodes, err := ParseStoreCatalogImportFile("catalog.csv", []byte("باركود,السعر\n٠٠١٢٣٤٥٦٧٨٩٠١,١٢٠٠\n"))
	if err != nil || len(barcodes) != 1 || barcodes[0].Barcode != "0012345678901" ||
		barcodes[0].PriceMinor != 1200 || barcodes[0].ErrorCode != "" {
		t.Fatalf("Arabic barcode/price digits were not normalized: rows=%+v err=%v", barcodes, err)
	}
}

func TestParseStoreCatalogImportFileCSVAccepts5000RowsRejects5001(t *testing.T) {
	var input strings.Builder
	input.WriteString("name,price\n")
	for i := 0; i < MaxStoreCatalogImportRows; i++ {
		fmt.Fprintf(&input, "Product %d,250\n", i)
	}
	rows, err := ParseStoreCatalogImportFile("catalog.csv", []byte(input.String()))
	if err != nil {
		t.Fatalf("CSV with exactly %d rows rejected: %v", MaxStoreCatalogImportRows, err)
	}
	if len(rows) != MaxStoreCatalogImportRows {
		t.Fatalf("CSV boundary row count: got %d, want %d", len(rows), MaxStoreCatalogImportRows)
	}
	if rows[len(rows)-1].RowNumber != MaxStoreCatalogImportRows+1 || rows[len(rows)-1].ErrorCode != "" {
		t.Fatalf("CSV boundary row missing or invalid: %+v", rows[len(rows)-1])
	}
	input.WriteString("Excess row,250\n")
	_, err = ParseStoreCatalogImportFile("catalog.csv", []byte(input.String()))
	if !errors.Is(err, ErrStoreCatalogImportFile) {
		t.Fatalf("CSV exceeding %d rows must be rejected: %v", MaxStoreCatalogImportRows, err)
	}
}

func TestParseStoreCatalogImportFileCSVPriceGrouping(t *testing.T) {
	cases := []struct {
		name      string
		price     string
		wantPrice int64
		invalid   bool
	}{
		{name: "plain whole YER", price: "1000", wantPrice: 1000},
		{name: "comma grouping", price: "1,000", wantPrice: 1000},
		{name: "Arabic thousands separator", price: "١٬٠٠٠", wantPrice: 1000},
		{name: "space grouping", price: "1 000", wantPrice: 1000},
		{name: "multiple valid groups", price: "1,000,000", wantPrice: 1000000},
		{name: "ambiguous decimal comma", price: "1,5", invalid: true},
		{name: "malformed groups", price: "12,34", invalid: true},
		{name: "empty group", price: "1,,000", invalid: true},
		{name: "mixed separators", price: "1, 000", invalid: true},
		{name: "Arabic digits malformed comma", price: "١,٥", invalid: true},
		{name: "interspersed spaces", price: "1 00 0", invalid: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var input strings.Builder
			input.WriteString("name,price\nSugar,")
			input.WriteString(fmt.Sprintf("%q", tc.price))
			input.WriteByte('\n')
			rows, err := ParseStoreCatalogImportFile("catalog.csv", []byte(input.String()))
			if err != nil || len(rows) != 1 {
				t.Fatalf("price row must remain previewable: %+v %v", rows, err)
			}
			if tc.invalid {
				if rows[0].ErrorCode != "INVALID_INPUT" {
					t.Fatalf("malformed grouping must not silently change the price: %+v", rows[0])
				}
				return
			}
			if rows[0].ErrorCode != "" || rows[0].PriceMinor != tc.wantPrice {
				t.Fatalf("valid grouped price changed: %+v; want %d", rows[0], tc.wantPrice)
			}
		})
	}
}
