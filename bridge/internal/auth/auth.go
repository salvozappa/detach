package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/mdp/qrterminal/v3"
)

const (
	// TokenLength is the number of random bytes for token generation
	TokenLength = 32
	// DefaultTokenFilePath is where the token is stored if not using env var
	DefaultTokenFilePath = "/app/data/token"
)

// Token holds the authentication token and related state
type Token struct {
	Value    string
	FilePath string
}

// LoadOrGenerateToken loads the auth token from env var, file, or generates a new one
func LoadOrGenerateToken(tokenFilePath string) *Token {
	t := &Token{
		FilePath: tokenFilePath,
	}

	if t.FilePath == "" {
		t.FilePath = DefaultTokenFilePath
	}

	// 1. Check DETACH_TOKEN environment variable
	if envToken := os.Getenv("DETACH_TOKEN"); envToken != "" {
		t.Value = strings.TrimSpace(envToken)
		log.Println("[AUTH] Using token from DETACH_TOKEN environment variable")
		return t
	}

	// 2. Check token file
	if data, err := os.ReadFile(t.FilePath); err == nil {
		t.Value = strings.TrimSpace(string(data))
		if t.Value != "" {
			log.Printf("[AUTH] Loaded token from file: %s", t.FilePath)
			return t
		}
	}

	// 3. Generate new token
	t.Value = generateSecureToken()
	log.Println("[AUTH] Generated new authentication token")

	// Save to file for persistence
	if err := t.saveToFile(); err != nil {
		log.Printf("[AUTH] Warning: Could not save token to file: %v", err)
	}

	return t
}

// ValidateToken performs constant-time comparison of tokens
func ValidateToken(provided, expected string) bool {
	if provided == "" || expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

// PrintPairingInfo displays the pairing URL and QR code
func PrintPairingInfo(webviewHost, token string) {
	if webviewHost == "" {
		webviewHost = "localhost:8080"
	}

	// Determine protocol (assume http for localhost, https otherwise)
	protocol := "http"
	if !strings.HasPrefix(webviewHost, "localhost") && !strings.HasPrefix(webviewHost, "127.0.0.1") {
		protocol = "https"
	}

	url := fmt.Sprintf("%s://%s?token=%s", protocol, webviewHost, token)

	fmt.Println()
	fmt.Println("=============================================")
	fmt.Println("Pair your device by opening this URL:")
	fmt.Println()
	fmt.Println(url)
	fmt.Println()
	fmt.Println("Or scan this QR code:")
	fmt.Println()
	qrterminal.GenerateWithConfig(url, qrterminal.Config{
		Level:     qrterminal.L,
		Writer:    os.Stdout,
		BlackChar: qrterminal.WHITE,
		WhiteChar: qrterminal.BLACK,
		QuietZone: 1,
	})
	fmt.Println()
	fmt.Println("=============================================")
	fmt.Println()
}

// generateSecureToken creates a cryptographically secure random token
func generateSecureToken() string {
	bytes := make([]byte, TokenLength)
	if _, err := rand.Read(bytes); err != nil {
		// This should never happen, but fall back to a less secure method if it does
		log.Printf("[AUTH] Warning: Could not generate secure random token: %v", err)
		return fmt.Sprintf("fallback-%d", os.Getpid())
	}
	// Use URL-safe base64 encoding without padding
	return base64.RawURLEncoding.EncodeToString(bytes)
}

// saveToFile persists the token to the configured file path
func (t *Token) saveToFile() error {
	// Ensure directory exists
	dir := t.FilePath[:strings.LastIndex(t.FilePath, "/")]
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create token directory: %w", err)
	}

	// Write token with restricted permissions
	if err := os.WriteFile(t.FilePath, []byte(t.Value), 0600); err != nil {
		return fmt.Errorf("failed to write token file: %w", err)
	}

	log.Printf("[AUTH] Saved token to file: %s", t.FilePath)
	return nil
}

// RegenerateToken generates a new token and saves it
func (t *Token) RegenerateToken() error {
	t.Value = generateSecureToken()
	log.Println("[AUTH] Regenerated authentication token")
	return t.saveToFile()
}
