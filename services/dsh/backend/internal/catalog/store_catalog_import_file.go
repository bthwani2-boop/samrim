package catalog

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

const (
	MaxStoreCatalogImportFileBytes = 20 << 20
	MaxStoreCatalogImportRows      = 5000
)

var ErrStoreCatalogImportFile = errors.New("store catalog import file is invalid")

type StoreCatalogImportFileRow struct {
	RowNumber    int
	Barcode      string
	PriceMinor   int64
	ErrorCode    string
	ErrorMessage string
}

// ParseStoreCatalogImportFile accepts user-facing barcode/price columns and
// leaves catalog identity resolution to DSH's canonical barcode resolver.
func ParseStoreCatalogImportFile(filename string, data []byte) ([]StoreCatalogImportFileRow, error) {
	if len(data) == 0 || len(data) > MaxStoreCatalogImportFileBytes {
		return nil, ErrStoreCatalogImportFile
	}
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	var matrix [][]string
	switch extension {
	case ".csv":
		r := csv.NewReader(bytes.NewReader(data))
		r.FieldsPerRecord = -1
		r.LazyQuotes = false
		for {
			row, err := r.Read()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("%w: malformed CSV", ErrStoreCatalogImportFile)
			}
			matrix = append(matrix, row)
			if len(matrix) > MaxStoreCatalogImportRows+1 {
				return nil, fmt.Errorf("%w: maximum is %d data rows", ErrStoreCatalogImportFile, MaxStoreCatalogImportRows)
			}
		}
	case ".xlsx":
		book, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{RawCellValue: true, UnzipSizeLimit: 40 << 20, UnzipXMLSizeLimit: 32 << 20})
		if err != nil {
			return nil, fmt.Errorf("%w: malformed XLSX", ErrStoreCatalogImportFile)
		}
		defer func() { _ = book.Close() }()
		sheets := book.GetSheetList()
		if len(sheets) == 0 {
			return nil, fmt.Errorf("%w: workbook has no worksheets", ErrStoreCatalogImportFile)
		}
		matrix, err = book.GetRows(sheets[0])
		if err != nil {
			return nil, fmt.Errorf("%w: worksheet could not be read", ErrStoreCatalogImportFile)
		}
		if len(matrix) > MaxStoreCatalogImportRows+1 {
			return nil, fmt.Errorf("%w: maximum is %d data rows", ErrStoreCatalogImportFile, MaxStoreCatalogImportRows)
		}
	default:
		return nil, fmt.Errorf("%w: only CSV and XLSX are supported", ErrStoreCatalogImportFile)
	}
	if len(matrix) < 2 {
		return nil, fmt.Errorf("%w: header and at least one data row are required", ErrStoreCatalogImportFile)
	}
	barcodeColumn, priceColumn := -1, -1
	for index, value := range matrix[0] {
		header := normalizeImportHeader(value)
		if isBarcodeImportHeader(header) {
			if barcodeColumn >= 0 {
				return nil, fmt.Errorf("%w: duplicate barcode header", ErrStoreCatalogImportFile)
			}
			barcodeColumn = index
		}
		if isPriceImportHeader(header) {
			if priceColumn >= 0 {
				return nil, fmt.Errorf("%w: duplicate price header", ErrStoreCatalogImportFile)
			}
			priceColumn = index
		}
	}
	if barcodeColumn < 0 || priceColumn < 0 {
		return nil, fmt.Errorf("%w: include barcode and price columns", ErrStoreCatalogImportFile)
	}
	rows := make([]StoreCatalogImportFileRow, 0, len(matrix)-1)
	for index, values := range matrix[1:] {
		if allImportCellsBlank(values) {
			continue
		}
		row := StoreCatalogImportFileRow{RowNumber: index + 2}
		if barcodeColumn < len(values) {
			row.Barcode = normalizeImportDigits(strings.TrimSpace(values[barcodeColumn]))
		}
		priceText := ""
		if priceColumn < len(values) {
			priceText = values[priceColumn]
		}
		row.PriceMinor, row.ErrorCode, row.ErrorMessage = parseStoreImportPrice(priceText)
		if row.Barcode == "" && row.ErrorCode == "" {
			row.ErrorCode, row.ErrorMessage = "INVALID_INPUT", "barcode is required"
		}
		if row.Barcode != "" && len([]rune(row.Barcode)) > 128 {
			row.ErrorCode, row.ErrorMessage = "INVALID_INPUT", "barcode exceeds 128 characters"
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("%w: no non-empty data rows", ErrStoreCatalogImportFile)
	}
	return rows, nil
}

func normalizeImportHeader(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "\ufeff"))
	value = strings.ToLower(value)
	value = strings.NewReplacer(" ", "", "_", "", "-", "", "ـ", "").Replace(value)
	return value
}

func isBarcodeImportHeader(value string) bool {
	switch value {
	case "barcode", "barcodeno", "barcodevalue", "identifier", "gtin", "ean", "upc", "باركود", "الباركود", "رقمالباركود", "رمزالمنتج":
		return true
	default:
		return false
	}
}

func isPriceImportHeader(value string) bool {
	switch value {
	case "price", "priceyer", "priceminor", "sellprice", "السعر", "سعر", "سعرالبيع", "السعرريال":
		return true
	default:
		return false
	}
}

func parseStoreImportPrice(value string) (int64, string, string) {
	value = normalizeImportDigits(strings.TrimSpace(value))
	value = strings.NewReplacer(",", "", "٬", "", " ", "").Replace(value)
	price, err := strconv.ParseInt(value, 10, 64)
	if err != nil || price <= 0 {
		return 0, "INVALID_INPUT", "price must be a positive whole amount in YER"
	}
	return price, "", ""
}

func normalizeImportDigits(value string) string {
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= '٠' && r <= '٩':
			b.WriteRune('0' + (r - '٠'))
		case r >= '۰' && r <= '۹':
			b.WriteRune('0' + (r - '۰'))
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func allImportCellsBlank(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}
