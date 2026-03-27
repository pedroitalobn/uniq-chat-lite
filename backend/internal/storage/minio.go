// Package storage provides MinIO/S3 object storage for media files.
package storage

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/rs/zerolog/log"
)

// Client wraps the MinIO SDK with convenience methods.
type Client struct {
	mc        *minio.Client
	bucket    string
	publicURL string // base public URL, e.g. http://localhost:9000
}

// GlobalStorage is the application-wide singleton (nil if MinIO not configured).
var GlobalStorage *Client

// NewClient initialises a MinIO client and ensures the bucket exists.
func NewClient(endpoint, accessKey, secretKey, bucket, publicURL string, useSSL bool) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio: new client: %w", err)
	}

	c := &Client{mc: mc, bucket: bucket, publicURL: strings.TrimSuffix(publicURL, "/")}
	if err := c.EnsureBucket(context.Background()); err != nil {
		return nil, err
	}
	GlobalStorage = c
	log.Info().Str("bucket", bucket).Str("endpoint", endpoint).Msg("minio: connected")
	return c, nil
}

// EnsureBucket creates the bucket with a public-read policy if it doesn't exist.
func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("minio: bucket exists check: %w", err)
	}
	if !exists {
		if err := c.mc.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("minio: make bucket: %w", err)
		}
		// Apply public-read policy so media URLs work without auth
		policy := fmt.Sprintf(`{
			"Version":"2012-10-17",
			"Statement":[{
				"Effect":"Allow",
				"Principal":{"AWS":["*"]},
				"Action":["s3:GetObject"],
				"Resource":["arn:aws:s3:::%s/*"]
			}]
		}`, c.bucket)
		if err := c.mc.SetBucketPolicy(ctx, c.bucket, policy); err != nil {
			log.Warn().Err(err).Msg("minio: failed to set public policy (non-fatal)")
		}
		log.Info().Str("bucket", c.bucket).Msg("minio: bucket created")
	}
	return nil
}

// UploadBytes stores raw bytes and returns the public URL.
// objectName example: "media/instance-id/2025/01/image-uuid.jpg"
func (c *Client) UploadBytes(ctx context.Context, objectName string, data []byte, contentType string) (string, error) {
	_, err := c.mc.PutObject(ctx, c.bucket, objectName, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("minio: upload %s: %w", objectName, err)
	}
	return c.PublicURL(objectName), nil
}

// MediaObjectName generates a deterministic object path for a media file.
// format: media/{instanceID}/{YYYY}/{MM}/{uuid}.{ext}
func MediaObjectName(instanceID, ext string) string {
	now := time.Now()
	return fmt.Sprintf("media/%s/%d/%02d/%s.%s",
		instanceID, now.Year(), now.Month(), uuid.New().String(), ext)
}

// MimeToExt returns a file extension for common MIME types.
func MimeToExt(mime string) string {
	m := map[string]string{
		"image/jpeg":          "jpg",
		"image/png":           "png",
		"image/webp":          "webp",
		"image/gif":           "gif",
		"audio/ogg":           "ogg",
		"audio/mpeg":          "mp3",
		"audio/mp4":           "m4a",
		"video/mp4":           "mp4",
		"application/pdf":     "pdf",
		"application/zip":     "zip",
		"text/plain":          "txt",
	}
	// Strip codec suffix: "audio/ogg; codecs=opus" → "audio/ogg"
	base := strings.Split(mime, ";")[0]
	base = strings.TrimSpace(base)
	if ext, ok := m[base]; ok {
		return ext
	}
	// Fallback: use part after /
	parts := strings.SplitN(base, "/", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return "bin"
}

// PublicURL returns the full public URL for an object.
func (c *Client) PublicURL(objectName string) string {
	return fmt.Sprintf("%s/%s/%s", c.publicURL, c.bucket, objectName)
}

// IsConfigured returns true if GlobalStorage is ready.
func IsConfigured() bool {
	return GlobalStorage != nil
}
