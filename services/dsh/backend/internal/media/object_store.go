package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	ErrInvalidConfiguration = errors.New("media storage configuration is invalid")
	ErrInvalidObjectKey     = errors.New("media object key is invalid")
	ErrObjectNotFound       = errors.New("media object was not found")
)

const MaxUploadBytes int64 = 10 * 1024 * 1024

type Config struct {
	Endpoint      string
	AccessKey     string
	SecretKey     string
	Bucket        string
	PublicBaseURL string
	MaxBytes      int64
}

type ObjectInfo struct {
	ContentType string
	Size        int64
	ETag        string
}

type Object struct {
	io.ReadCloser
	Info ObjectInfo
}

type Store interface {
	EnsureBucket(context.Context) error
	Put(context.Context, string, io.Reader, int64, string) error
	Delete(context.Context, string) error
	Get(context.Context, string) (*Object, error)
	PublicURL(string) string
}

type S3Store struct {
	client *minio.Client
	config Config
}

func NewFromEnv() (*S3Store, Config, error) {
	maxBytes := MaxUploadBytes
	if raw := strings.TrimSpace(os.Getenv("DSH_MEDIA_MAX_BYTES")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 1 || parsed > MaxUploadBytes {
			return nil, Config{}, fmt.Errorf("%w: DSH_MEDIA_MAX_BYTES", ErrInvalidConfiguration)
		}
		maxBytes = parsed
	}
	config := Config{
		Endpoint:      strings.TrimSpace(os.Getenv("DSH_MEDIA_S3_ENDPOINT")),
		AccessKey:     strings.TrimSpace(os.Getenv("DSH_MEDIA_ACCESS_KEY")),
		SecretKey:     strings.TrimSpace(os.Getenv("DSH_MEDIA_SECRET_KEY")),
		Bucket:        strings.TrimSpace(os.Getenv("DSH_MEDIA_BUCKET")),
		PublicBaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("DSH_MEDIA_PUBLIC_BASE_URL")), "/"),
		MaxBytes:      maxBytes,
	}
	store, err := New(config)
	return store, config, err
}

func New(config Config) (*S3Store, error) {
	parsed, err := url.Parse(config.Endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Path != "" || config.AccessKey == "" || config.SecretKey == "" || !validBucket(config.Bucket) || config.PublicBaseURL == "" || config.MaxBytes < 1 || config.MaxBytes > MaxUploadBytes {
		return nil, ErrInvalidConfiguration
	}
	publicURL, err := url.Parse(config.PublicBaseURL)
	if err != nil || publicURL.Host == "" || (publicURL.Scheme != "http" && publicURL.Scheme != "https") {
		return nil, ErrInvalidConfiguration
	}
	client, err := minio.New(parsed.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(config.AccessKey, config.SecretKey, ""),
		Secure: parsed.Scheme == "https",
	})
	if err != nil {
		return nil, fmt.Errorf("%w: initialize S3 client", ErrInvalidConfiguration)
	}
	return &S3Store{client: client, config: config}, nil
}

func (s *S3Store) EnsureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.config.Bucket)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	return s.client.MakeBucket(ctx, s.config.Bucket, minio.MakeBucketOptions{Region: "us-east-1"})
}

func (s *S3Store) Put(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) error {
	if err := ValidateObjectKey(objectKey); err != nil || size < 1 || size > s.config.MaxBytes || !validContentType(contentType) {
		return ErrInvalidObjectKey
	}
	_, err := s.client.PutObject(ctx, s.config.Bucket, objectKey, reader, size, minio.PutObjectOptions{ContentType: contentType, CacheControl: "public, max-age=31536000, immutable"})
	return err
}

func (s *S3Store) Delete(ctx context.Context, objectKey string) error {
	if err := ValidateObjectKey(objectKey); err != nil {
		return err
	}
	return s.client.RemoveObject(ctx, s.config.Bucket, objectKey, minio.RemoveObjectOptions{})
}

func (s *S3Store) Get(ctx context.Context, objectKey string) (*Object, error) {
	if err := ValidateObjectKey(objectKey); err != nil {
		return nil, err
	}
	info, err := s.client.StatObject(ctx, s.config.Bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		response := minio.ToErrorResponse(err)
		if response.Code == "NoSuchKey" || response.Code == "NoSuchObject" || response.StatusCode == 404 {
			return nil, ErrObjectNotFound
		}
		return nil, err
	}
	object, err := s.client.GetObject(ctx, s.config.Bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return &Object{ReadCloser: object, Info: ObjectInfo{ContentType: info.ContentType, Size: info.Size, ETag: info.ETag}}, nil
}

func (s *S3Store) PublicURL(objectKey string) string {
	if err := ValidateObjectKey(objectKey); err != nil {
		return ""
	}
	return strings.TrimRight(s.config.PublicBaseURL, "/") + "/" + objectKey
}

func ValidateObjectKey(objectKey string) error {
	clean := path.Clean(strings.TrimSpace(objectKey))
	if clean != objectKey || (!strings.HasPrefix(objectKey, "catalog/products/") && !strings.HasPrefix(objectKey, "catalog/categories/") && !strings.HasPrefix(objectKey, "store-profile/assets/") && !strings.HasPrefix(objectKey, "marketing/discovery-content/")) || strings.Contains(objectKey, "\\") || strings.Contains(objectKey, "..") || len(objectKey) > 512 {
		return ErrInvalidObjectKey
	}
	for _, segment := range strings.Split(objectKey, "/") {
		if segment == "" || !validPathSegment(segment) {
			return ErrInvalidObjectKey
		}
	}
	return nil
}

func KeyForStoreProfileUpload(assetID, idempotencyKey, contentSHA256, contentType string) (string, error) {
	if !validPathSegment(assetID) || !validPathSegment(contentSHA256) || len(contentSHA256) != 64 || !validContentType(contentType) {
		return "", ErrInvalidObjectKey
	}
	keyHash := sha256.Sum256([]byte(idempotencyKey))
	extension := "jpg"
	if contentType == "image/png" {
		extension = "png"
	}
	return fmt.Sprintf("store-profile/assets/%s/%s.%s", assetID, hex.EncodeToString(keyHash[:]), extension), nil
}

func KeyForUpload(productID, idempotencyKey, contentSHA256, contentType string) (string, error) {
	if !validPathSegment(productID) || !validPathSegment(contentSHA256) || len(contentSHA256) != 64 || !validContentType(contentType) {
		return "", ErrInvalidObjectKey
	}
	keyHash := sha256.Sum256([]byte(idempotencyKey))
	extension := "jpg"
	if contentType == "image/png" {
		extension = "png"
	}
	return fmt.Sprintf("catalog/products/%s/uploads/%s-%s.%s", productID, hex.EncodeToString(keyHash[:]), contentSHA256, extension), nil
}

func KeyForCategoryUpload(categoryID, idempotencyKey, contentSHA256, contentType string) (string, error) {
	if !validPathSegment(categoryID) || !validPathSegment(contentSHA256) || len(contentSHA256) != 64 || !validContentType(contentType) {
		return "", ErrInvalidObjectKey
	}
	keyHash := sha256.Sum256([]byte(idempotencyKey))
	extension := "jpg"
	if contentType == "image/png" {
		extension = "png"
	}
	return fmt.Sprintf("catalog/categories/%s/uploads/%s-%s.%s", categoryID, hex.EncodeToString(keyHash[:]), contentSHA256, extension), nil
}

func KeyForMarketingUpload(contentID, idempotencyKey, contentSHA256, contentType string) (string, error) {
	if !validPathSegment(contentID) || !validPathSegment(contentSHA256) || len(contentSHA256) != 64 || !validContentType(contentType) {
		return "", ErrInvalidObjectKey
	}
	keyHash := sha256.Sum256([]byte(idempotencyKey))
	extension := "jpg"
	if contentType == "image/png" {
		extension = "png"
	}
	return fmt.Sprintf("marketing/discovery-content/%s/%s-%s.%s", contentID, hex.EncodeToString(keyHash[:]), contentSHA256, extension), nil
}

func validBucket(value string) bool {
	return len(value) >= 3 && len(value) <= 63 && validPathSegment(value)
}

func validPathSegment(value string) bool {
	if value == "" || len(value) > 256 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}

func validContentType(value string) bool {
	return value == "image/jpeg" || value == "image/png"
}

func ValidateImageBytes(data []byte) (string, int, int, error) {
	if len(data) < 1 || int64(len(data)) > MaxUploadBytes {
		return "", 0, 0, ErrInvalidObjectKey
	}
	contentType := http.DetectContentType(data)
	if !validContentType(contentType) {
		return "", 0, 0, ErrInvalidObjectKey
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 6000 || config.Height > 6000 {
		return "", 0, 0, ErrInvalidObjectKey
	}
	return contentType, config.Width, config.Height, nil
}

func WithTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 15*time.Second)
}
