package shop

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

// credentials.go — encrypt/decrypt de credenciais OAuth/API key dos
// providers de e-commerce.
//
// Formato: AES-256-GCM. Chave derivada do env SHOP_ENCRYPT_KEY (qualquer
// string de qualquer tamanho — passada por SHA-256 pra ter 32 bytes).
//
// Layout do ciphertext encodado (base64):
//   [12 bytes nonce][N bytes ciphertext+tag]
//
// Convenção: ShopIntegration.Credentials é JSON encriptado contendo
// {access_token, refresh_token, store_url, expires_at, ...} — cada
// provider sabe sua estrutura. Wrappers MarshalCredentials/Unmarshal
// fazem o JSON+encrypt em um passo.

const (
	envEncryptKey = "SHOP_ENCRYPT_KEY"
	prefix        = "enc:v1:"
)

// ErrNoEncryptKey é retornado quando SHOP_ENCRYPT_KEY não está setado.
// Em prod isso DEVE quebrar o startup (chave fraca = vazamento de tokens).
// Em dev/test, fallback pra chave conhecida pra facilitar (ver derivedKey).
var ErrNoEncryptKey = errors.New("SHOP_ENCRYPT_KEY não configurado")

// derivedKey deriva 32 bytes via SHA-256(env). Em dev sem env, usa key
// fraca conhecida pra não bloquear desenvolvimento — mas registra warn.
func derivedKey() ([32]byte, error) {
	raw := os.Getenv(envEncryptKey)
	if raw == "" {
		// Dev fallback. Em prod o startup loga warn no boot via ValidateConfig.
		raw = "uniq-chat-dev-shop-key-NOT-FOR-PRODUCTION"
	}
	return sha256.Sum256([]byte(raw)), nil
}

// EncryptString criptografa uma string e retorna base64. Pra strings
// vazias retorna vazio (não cria payload encriptado de string vazia,
// que ficaria != "" no banco).
func EncryptString(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	key, err := derivedKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return prefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

// DecryptString reverte EncryptString. Aceita texto puro (sem prefix)
// como fallback retrocompat — facilita migração de dados antigos.
func DecryptString(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	// Retrocompat: se vier sem prefix "enc:v1:", devolve cru (legacy).
	if len(encoded) < len(prefix) || encoded[:len(prefix)] != prefix {
		return encoded, nil
	}
	encoded = encoded[len(prefix):]

	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}
	key, err := derivedKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", errors.New("ciphertext muito curto")
	}
	nonce, cipherbytes := raw[:nonceSize], raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, cipherbytes, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plain), nil
}

// MarshalCredentials serializa um struct/map em JSON e encripta.
// Cada provider chama isso passando seu próprio struct (ex:
// ShopifyCredentials{AccessToken, ShopDomain}).
func MarshalCredentials(v any) (string, error) {
	if v == nil {
		return "", nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return EncryptString(string(b))
}

// UnmarshalCredentials decripta e deserializa em out (ponteiro).
func UnmarshalCredentials(encoded string, out any) error {
	if encoded == "" {
		return nil
	}
	plain, err := DecryptString(encoded)
	if err != nil {
		return err
	}
	if plain == "" {
		return nil
	}
	return json.Unmarshal([]byte(plain), out)
}
