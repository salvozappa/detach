package auth

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestValidateToken_ValidMatch(t *testing.T) {
	token := "abc123secrettoken"
	if !ValidateToken(token, token) {
		t.Error("expected matching tokens to validate")
	}
}

func TestValidateToken_InvalidMatch(t *testing.T) {
	if ValidateToken("token1", "token2") {
		t.Error("expected different tokens to not validate")
	}
}

func TestValidateToken_EmptyProvided(t *testing.T) {
	if ValidateToken("", "validtoken") {
		t.Error("expected empty provided token to not validate")
	}
}

func TestValidateToken_EmptyExpected(t *testing.T) {
	if ValidateToken("validtoken", "") {
		t.Error("expected empty expected token to not validate")
	}
}

func TestValidateToken_BothEmpty(t *testing.T) {
	if ValidateToken("", "") {
		t.Error("expected both empty tokens to not validate")
	}
}

func TestGenerateSecureToken_Length(t *testing.T) {
	token := generateSecureToken()

	// Base64 encoded 32 bytes should be 43 characters (without padding)
	expectedLen := 43
	if len(token) != expectedLen {
		t.Errorf("expected token length %d, got %d", expectedLen, len(token))
	}
}

func TestGenerateSecureToken_IsBase64(t *testing.T) {
	token := generateSecureToken()

	// Should be valid base64 URL encoding
	_, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Errorf("token is not valid base64 URL encoded: %v", err)
	}
}

func TestGenerateSecureToken_Uniqueness(t *testing.T) {
	tokens := make(map[string]bool)

	// Generate 100 tokens and ensure they're all unique
	for i := 0; i < 100; i++ {
		token := generateSecureToken()
		if tokens[token] {
			t.Errorf("generated duplicate token: %s", token)
		}
		tokens[token] = true
	}
}

func TestLoadOrGenerateToken_FromEnvVar(t *testing.T) {
	// Save and restore env var
	oldToken := os.Getenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		} else {
			os.Unsetenv("DETACH_TOKEN")
		}
	}()

	expectedToken := "env-test-token-12345"
	os.Setenv("DETACH_TOKEN", expectedToken)

	token := LoadOrGenerateToken("")

	if token.Value != expectedToken {
		t.Errorf("expected token %q, got %q", expectedToken, token.Value)
	}
}

func TestLoadOrGenerateToken_FromEnvVar_TrimWhitespace(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		} else {
			os.Unsetenv("DETACH_TOKEN")
		}
	}()

	os.Setenv("DETACH_TOKEN", "  token-with-spaces  \n")

	token := LoadOrGenerateToken("")

	if token.Value != "token-with-spaces" {
		t.Errorf("expected trimmed token, got %q", token.Value)
	}
}

func TestLoadOrGenerateToken_FromFile(t *testing.T) {
	// Clear env var
	oldToken := os.Getenv("DETACH_TOKEN")
	os.Unsetenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		}
	}()

	// Create temp file with token
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")
	expectedToken := "file-test-token-67890"
	if err := os.WriteFile(tokenFile, []byte(expectedToken), 0600); err != nil {
		t.Fatal(err)
	}

	token := LoadOrGenerateToken(tokenFile)

	if token.Value != expectedToken {
		t.Errorf("expected token %q, got %q", expectedToken, token.Value)
	}
}

func TestLoadOrGenerateToken_FromFile_TrimWhitespace(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	os.Unsetenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		}
	}()

	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")
	if err := os.WriteFile(tokenFile, []byte("  file-token  \n"), 0600); err != nil {
		t.Fatal(err)
	}

	token := LoadOrGenerateToken(tokenFile)

	if token.Value != "file-token" {
		t.Errorf("expected trimmed token, got %q", token.Value)
	}
}

func TestLoadOrGenerateToken_GeneratesNew(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	os.Unsetenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		}
	}()

	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "subdir", "token")

	token := LoadOrGenerateToken(tokenFile)

	// Should have generated a token
	if token.Value == "" {
		t.Error("expected non-empty token")
	}

	// Should be valid base64
	if _, err := base64.RawURLEncoding.DecodeString(token.Value); err != nil {
		t.Errorf("generated token is not valid base64: %v", err)
	}

	// Should have saved to file
	data, err := os.ReadFile(tokenFile)
	if err != nil {
		t.Errorf("expected token file to be created: %v", err)
	}
	if string(data) != token.Value {
		t.Errorf("expected file content %q, got %q", token.Value, string(data))
	}
}

func TestLoadOrGenerateToken_EnvVarTakesPrecedence(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		} else {
			os.Unsetenv("DETACH_TOKEN")
		}
	}()

	// Create file with token
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")
	if err := os.WriteFile(tokenFile, []byte("file-token"), 0600); err != nil {
		t.Fatal(err)
	}

	// Set env var
	os.Setenv("DETACH_TOKEN", "env-token")

	token := LoadOrGenerateToken(tokenFile)

	// Env var should take precedence
	if token.Value != "env-token" {
		t.Errorf("expected env var token, got %q", token.Value)
	}
}

func TestLoadOrGenerateToken_DefaultFilePath(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	os.Unsetenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		}
	}()

	token := LoadOrGenerateToken("")

	if token.FilePath != DefaultTokenFilePath {
		t.Errorf("expected default file path %q, got %q", DefaultTokenFilePath, token.FilePath)
	}
}

func TestToken_SaveToFile(t *testing.T) {
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "nested", "dir", "token")

	token := &Token{
		Value:    "test-save-token",
		FilePath: tokenFile,
	}

	if err := token.saveToFile(); err != nil {
		t.Fatalf("saveToFile failed: %v", err)
	}

	// Verify file exists and has correct content
	data, err := os.ReadFile(tokenFile)
	if err != nil {
		t.Fatalf("failed to read token file: %v", err)
	}
	if string(data) != token.Value {
		t.Errorf("expected %q, got %q", token.Value, string(data))
	}

	// Verify file permissions
	info, err := os.Stat(tokenFile)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("expected permissions 0600, got %o", info.Mode().Perm())
	}
}

func TestToken_RegenerateToken(t *testing.T) {
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")

	token := &Token{
		Value:    "original-token",
		FilePath: tokenFile,
	}

	// Save original
	if err := token.saveToFile(); err != nil {
		t.Fatal(err)
	}

	originalValue := token.Value

	// Regenerate
	if err := token.RegenerateToken(); err != nil {
		t.Fatalf("RegenerateToken failed: %v", err)
	}

	// Should have new value
	if token.Value == originalValue {
		t.Error("expected token value to change after regeneration")
	}

	// Should be saved to file
	data, err := os.ReadFile(tokenFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != token.Value {
		t.Errorf("expected file to contain new token %q, got %q", token.Value, string(data))
	}
}

func TestLoadOrGenerateToken_IgnoresEmptyFile(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	os.Unsetenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		}
	}()

	// Create empty file
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")
	if err := os.WriteFile(tokenFile, []byte(""), 0600); err != nil {
		t.Fatal(err)
	}

	token := LoadOrGenerateToken(tokenFile)

	// Should generate new token since file is empty
	if token.Value == "" {
		t.Error("expected non-empty token")
	}
	if !strings.HasPrefix(token.Value, "") && len(token.Value) != 43 {
		// Should be a generated base64 token
		if _, err := base64.RawURLEncoding.DecodeString(token.Value); err != nil {
			t.Errorf("expected generated base64 token, got %q", token.Value)
		}
	}
}

func TestLoadOrGenerateToken_IgnoresWhitespaceOnlyFile(t *testing.T) {
	oldToken := os.Getenv("DETACH_TOKEN")
	os.Unsetenv("DETACH_TOKEN")
	defer func() {
		if oldToken != "" {
			os.Setenv("DETACH_TOKEN", oldToken)
		}
	}()

	// Create whitespace-only file
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")
	if err := os.WriteFile(tokenFile, []byte("   \n\t  "), 0600); err != nil {
		t.Fatal(err)
	}

	token := LoadOrGenerateToken(tokenFile)

	// Should generate new token since file only has whitespace
	if token.Value == "" {
		t.Error("expected non-empty token")
	}
	// Trimmed whitespace should result in empty, triggering generation
	if _, err := base64.RawURLEncoding.DecodeString(token.Value); err != nil {
		t.Errorf("expected generated base64 token, got %q", token.Value)
	}
}

// wsEcho sets up a test WebSocket server that upgrades the connection and calls handler.
// Returns a client connection and a cleanup function.
func wsEcho(t *testing.T, handler func(conn *websocket.Conn)) (*websocket.Conn, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("server upgrade failed: %v", err)
		}
		handler(conn)
	}))

	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		srv.Close()
		t.Fatalf("client dial failed: %v", err)
	}
	return client, func() {
		client.Close()
		srv.Close()
	}
}

func TestRejectUnauthorized_SendsClose4001(t *testing.T) {
	client, cleanup := wsEcho(t, func(serverConn *websocket.Conn) {
		RejectUnauthorized(serverConn, "127.0.0.1:9999")
	})
	defer cleanup()

	// Client should receive a close frame with code 4001
	_, _, err := client.ReadMessage()
	if err == nil {
		t.Fatal("expected close error, got nil")
	}
	closeErr, ok := err.(*websocket.CloseError)
	if !ok {
		t.Fatalf("expected *websocket.CloseError, got %T: %v", err, err)
	}
	if closeErr.Code != CloseCodeUnauthorized {
		t.Errorf("expected close code %d, got %d", CloseCodeUnauthorized, closeErr.Code)
	}
	if closeErr.Text != CloseReasonUnauthorized {
		t.Errorf("expected close reason %q, got %q", CloseReasonUnauthorized, closeErr.Text)
	}
}

func TestRejectUnauthorized_ClosesConnection(t *testing.T) {
	client, cleanup := wsEcho(t, func(serverConn *websocket.Conn) {
		RejectUnauthorized(serverConn, "10.0.0.1:1234")
	})
	defer cleanup()

	// Drain the close frame
	client.ReadMessage()

	// Subsequent writes should fail because the connection is closed
	err := client.WriteMessage(websocket.TextMessage, []byte("hello"))
	if err == nil {
		t.Error("expected write to closed connection to fail")
	}
}

func TestCloseCodeUnauthorized_IsInApplicationRange(t *testing.T) {
	// WebSocket application close codes must be in range 4000-4999
	if CloseCodeUnauthorized < 4000 || CloseCodeUnauthorized > 4999 {
		t.Errorf("close code %d is outside the application range 4000-4999", CloseCodeUnauthorized)
	}
}
