package whatsapp

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"golang.org/x/net/proxy"
)

// ProxyConfig represents the proxy configuration for a WhatsApp instance.
type ProxyConfig struct {
	Enabled  bool
	Type     string // "http" | "https" | "socks5"
	Host     string
	Port     int
	Username string
	Password string
}

// BuildProxyURL assembles the proxy URL in scheme://user:pass@host:port format.
func BuildProxyURL(cfg *ProxyConfig) (*url.URL, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, nil
	}

	scheme := cfg.Type
	if scheme == "https" {
		scheme = "http" // http.ProxyURL handles both, scheme just signals protocol
	}

	rawURL := fmt.Sprintf("%s://%s:%d", scheme, cfg.Host, cfg.Port)
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	if cfg.Username != "" {
		u.User = url.UserPassword(cfg.Username, cfg.Password)
	}
	return u, nil
}

// BuildHTTPClient creates an *http.Client configured with the proxy.
// – SOCKS5: uses golang.org/x/net/proxy dialer
// – HTTP/HTTPS: uses http.ProxyURL
func BuildHTTPClient(cfg *ProxyConfig) (*http.Client, error) {
	if cfg == nil || !cfg.Enabled {
		return &http.Client{Timeout: 30 * time.Second}, nil
	}

	var transport *http.Transport

	switch cfg.Type {
	case "socks5":
		auth := (*proxy.Auth)(nil)
		if cfg.Username != "" {
			auth = &proxy.Auth{User: cfg.Username, Password: cfg.Password}
		}
		dialer, err := proxy.SOCKS5("tcp", fmt.Sprintf("%s:%d", cfg.Host, cfg.Port), auth, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("failed to create SOCKS5 dialer: %w", err)
		}
		transport = &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.Dial(network, addr)
			},
			TLSHandshakeTimeout: 10 * time.Second,
		}

	case "http", "https":
		proxyURL, err := BuildProxyURL(cfg)
		if err != nil {
			return nil, err
		}
		transport = &http.Transport{
			Proxy:               http.ProxyURL(proxyURL),
			TLSHandshakeTimeout: 10 * time.Second,
		}

	default:
		return nil, fmt.Errorf("unsupported proxy type: %s", cfg.Type)
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}, nil
}

// ipResponse is the expected shape from httpbin.org/ip
type ipResponse struct {
	Origin string `json:"origin"`
}

// TestProxy tests connectivity through the proxy and returns the external IP.
// timeout is hard-coded to 10s.
func TestProxy(cfg *ProxyConfig) (externalIP string, latencyMs int64, err error) {
	client, err := BuildHTTPClient(cfg)
	if err != nil {
		return "", 0, fmt.Errorf("failed to build proxy client: %w", err)
	}
	client.Timeout = 10 * time.Second

	start := time.Now()
	resp, err := client.Get("https://httpbin.org/ip")
	if err != nil {
		return "", 0, fmt.Errorf("proxy connection failed: %w", err)
	}
	defer resp.Body.Close()

	latencyMs = time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		return "", latencyMs, fmt.Errorf("httpbin returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", latencyMs, fmt.Errorf("failed to read response: %w", err)
	}

	var ipResp ipResponse
	if err := json.Unmarshal(body, &ipResp); err != nil {
		return "", latencyMs, fmt.Errorf("failed to parse response: %w", err)
	}

	return ipResp.Origin, latencyMs, nil
}

// EncryptProxyPassword encrypts the password using AES-256-GCM.
// Key is read from PROXY_ENCRYPTION_KEY env variable (must be 32 bytes).
func EncryptProxyPassword(password string) (string, error) {
	if password == "" {
		return "", nil
	}
	key := getEncryptionKey()

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(password), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// DecryptProxyPassword decrypts a previously encrypted proxy password.
func DecryptProxyPassword(encrypted string) (string, error) {
	if encrypted == "" {
		return "", nil
	}
	key := getEncryptionKey()

	data, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

func getEncryptionKey() []byte {
	key := os.Getenv("PROXY_ENCRYPTION_KEY")
	b := []byte(key)
	// Pad or truncate to exactly 32 bytes
	result := make([]byte, 32)
	copy(result, b)
	return result
}

// ProxyAddressString returns the proxy URL string suitable for whatsmeow.SetProxyAddress
func ProxyAddressString(cfg *ProxyConfig) string {
	if cfg == nil || !cfg.Enabled {
		return ""
	}
	scheme := cfg.Type
	addr := cfg.Host + ":" + strconv.Itoa(cfg.Port)
	if cfg.Username != "" {
		return fmt.Sprintf("%s://%s:%s@%s", scheme, cfg.Username, cfg.Password, addr)
	}
	return fmt.Sprintf("%s://%s", scheme, addr)
}
