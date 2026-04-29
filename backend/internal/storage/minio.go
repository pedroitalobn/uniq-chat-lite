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

// EnsureBucket verifica se o bucket existe. NÃO cria automaticamente —
// em produção (Hetzner Object Storage, R2, etc.) o admin cria manualmente
// pra escolher visibilidade (private), region e nome. Se não existir, só
// loga warning — uploads vão falhar com mensagem clara depois.
//
// NÃO aplica policy pública. Use bucket private + PresignURL.
func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("minio: bucket exists check: %w", err)
	}
	if !exists {
		log.Warn().Str("bucket", c.bucket).
			Msg("storage bucket não encontrado — crie manualmente no painel do provedor")
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
		"image/jpeg":      "jpg",
		"image/png":       "png",
		"image/webp":      "webp",
		"image/gif":       "gif",
		"audio/ogg":       "ogg",
		"audio/mpeg":      "mp3",
		"audio/mp4":       "m4a",
		"video/mp4":       "mp4",
		"application/pdf": "pdf",
		"application/zip": "zip",
		"text/plain":      "txt",
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
// Use only for buckets configurados como public-read; pra buckets
// private (recomendado em produção) use PresignURL.
//
// Robusto contra duplicação de bucket: se publicURL já contém o nome do
// bucket (virtual-hosted style, ex: https://uniq-chat-media.fsn1.your-
// objectstorage.com), gera URL com bucket UMA vez:
//
//	https://uniq-chat-media.fsn1.your-objectstorage.com/{key}
//
// Path-style (publicURL = https://fsn1.your-objectstorage.com) inclui:
//
//	https://fsn1.your-objectstorage.com/{bucket}/{key}
func (c *Client) PublicURL(objectName string) string {
	// Detecta virtual-hosted: bucket no host (depois do //, antes do primeiro /)
	host := c.publicURL
	if idx := strings.Index(host, "://"); idx >= 0 {
		host = host[idx+3:]
	}
	if slash := strings.Index(host, "/"); slash >= 0 {
		host = host[:slash]
	}
	if strings.HasPrefix(host, c.bucket+".") {
		// virtual-hosted: bucket já no subdomain
		return fmt.Sprintf("%s/%s", c.publicURL, objectName)
	}
	// path-style: bucket vai no path
	return fmt.Sprintf("%s/%s/%s", c.publicURL, c.bucket, objectName)
}

// PresignURL gera uma URL assinada (signed URL) com TTL pra um objeto
// privado. Bucket private + signed URL é o padrão pra produção: agentes
// veem a mídia normalmente, mas a URL expira em algumas horas, evitando
// que vazamentos (logs, screenshots, history) deem acesso permanente.
//
// `objectName` é o key dentro do bucket (sem prefixo URL). TTL típico:
// 24h pra mídia de inbox (cobre o uso normal sem precisar refresh).
func (c *Client) PresignURL(ctx context.Context, objectName string, ttl time.Duration) (string, error) {
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, objectName, ttl, nil)
	if err != nil {
		return "", fmt.Errorf("minio: presign %s: %w", objectName, err)
	}
	return u.String(), nil
}

func (c *Client) BucketName() string {
	return c.bucket
}

// KeyFromURL extrai o objectName de uma URL gerada por PublicURL().
// Retorna "" se a URL não pertence ao bucket configurado. Usado pra
// migrar storage de modo público pra privado: detecta URLs antigas
// salvas no MessageLog.Content e substitui pelo key extraído.
//
// Aceita ambos formatos:
//
//	path-style:        https://host/bucket/key
//	virtual-hosted:    https://bucket.host/key
func (c *Client) KeyFromURL(url string) string {
	// Tenta virtual-hosted primeiro (publicURL já tem bucket no host)
	prefix := c.publicURL + "/"
	host := c.publicURL
	if idx := strings.Index(host, "://"); idx >= 0 {
		host = host[idx+3:]
	}
	if slash := strings.Index(host, "/"); slash >= 0 {
		host = host[:slash]
	}
	if strings.HasPrefix(host, c.bucket+".") {
		if strings.HasPrefix(url, prefix) {
			return strings.TrimPrefix(url, prefix)
		}
		return ""
	}
	// Path-style
	prefix = c.publicURL + "/" + c.bucket + "/"
	if !strings.HasPrefix(url, prefix) {
		return ""
	}
	return strings.TrimPrefix(url, prefix)
}

// IsConfigured returns true if GlobalStorage is ready.
func IsConfigured() bool {
	return GlobalStorage != nil
}
